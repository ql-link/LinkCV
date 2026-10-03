import asyncio
import json
from datetime import timedelta
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from linkresume.application.interviews import transcription_service as service
from linkresume.core.config import Settings
from linkresume.core.database import utc_now
from linkresume.main import create_app
from linkresume.modules.datasets.models import DatasetTranscriptionTask, UserDataset
from linkresume.modules.identity.account_deletion_service import active_types
from linkresume.modules.identity.models import User
from linkresume.modules.interviews.models import InterviewSession
from linkresume.modules.llm.models import LLMModel, LLMModelRoute, LLMProviderConnection, LLMUseCaseRoute, LLMCallLog
from linkresume.modules.llm.resolver import RECORDING_TRANSCRIPTION, validation_fingerprint
from linkresume.modules.speech.file_transcription import FileTranscriptionError
from linkresume.modules.speech.media_token import audio_url, probe_wav
from linkresume.workers.interview_transcription_worker import InterviewTranscriptionProcessor
from tests.fakes import FakeRedis
from tests.integration.api.test_interview_prep import create_session
from tests.integration.api.test_interviews import FakeStorage, FakeObjectResponse, asset_headers, register


class RangeStorage(FakeStorage):
    def get(self, object_name, *, offset=0, length=0):
        content = self.objects[object_name]
        return FakeObjectResponse(content[offset:offset+length] if length else content[offset:])


class FakeFileGateway:
    def __init__(self):
        self.submits = []
        self.polls = []
        self.error = None
        self.status = 'succeeded'

    async def submit(self, target, url):
        self.submits.append((target, url))
        if self.error:
            raise self.error
        return 'supplier-task-1'

    async def poll(self, target, task_id):
        self.polls.append(task_id)
        if self.error:
            raise self.error
        return {'status': self.status, 'url': 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/draft.json', 'duration_seconds': 4}

    async def result(self, target, url, *, allow_empty=False):
        return {'schema_version': 1, 'text': '问：介绍项目。答：张三负责虚构项目。', 'sentences': [{'text': '介绍项目。', 'start_ms': 0, 'end_ms': 2000}], 'duration_ms': 4000}


def make_app(tmp_path, *, configured=True, database_url=None):
    settings = Settings(database_url=database_url or f'sqlite+pysqlite:///{tmp_path / "asr.db"}',
                        jwt_secret='fictional-integration-signing-secret-32-bytes',
                        asr_media_base_url='https://audio.example.test',
                        llm_credential_encryption_keys=f'test:{Fernet.generate_key().decode()}')
    app = create_app(settings, storage=RangeStorage(), redis=FakeRedis(), create_schema=True)
    if database_url is None:
        # Exercise FK deletion semantics instead of SQLite's default disabled FKs.
        engine=app.state.session_factory.kw['bind']
        def enable_foreign_keys(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
        event.listen(engine,'connect',enable_foreign_keys)
        engine.dispose()
    gateway = FakeFileGateway()
    app.state.llm_service.file_transcription_gateway = gateway
    if configured:
        with app.state.session_factory() as db:
            connection = LLMProviderConnection(provider_code='aliyun', name='测试连接',
                credential_ciphertext=app.state.llm_service.encrypt_credential(json.dumps({'api_key': 'fictional-key'})),
                settings_json={'region': 'cn-beijing', 'workspace_id': 'fictional-workspace'}, enabled=True)
            model = LLMModel(display_name='录音文件测试模型')
            db.add_all([connection, model]); db.flush()
            route = LLMModelRoute(model_id=model.id, connection_id=connection.id, target_kind='model',
                invoke_target='fun-asr', origin='manual', enabled=True, target_available=True)
            db.add(route); db.flush()
            binding = LLMUseCaseRoute(use_case=RECORDING_TRANSCRIPTION, route_id=route.id, protocol_code='aliyun_asr_file',
                priority=100, enabled=True, validated_at=utc_now())
            db.add(binding); db.flush()
            binding.validated_fingerprint = validation_fingerprint(binding, route, connection)
            db.commit()
    processor = InterviewTranscriptionProcessor(session_factory=app.state.session_factory, settings=settings, llm_service=app.state.llm_service)
    return app, gateway, processor


def audio(client, session):
    response = client.post(f'/api/interview-sessions/{session["id"]}/assets', data={'source_type': 'uploaded'},
        files={'file': (f'虚构面试-{uuid4().hex[:8]}.wav', probe_wav(), 'audio/wav')}, headers=asset_headers())
    assert response.status_code == 201, response.text
    return response.json()['asset']


def start(client, session, asset, request_id=None):
    return client.post(f'/api/interview-sessions/{session["id"]}/assets/{asset["id"]}/transcription', json={'request_id': request_id or str(uuid4())})


def due(app):
    with app.state.session_factory() as db:
        task = db.scalar(select(DatasetTranscriptionTask))
        task.updated_at = utc_now() - timedelta(minutes=6)
        db.commit()


def test_file_asr_draft_survives_refresh_and_requires_user_confirmation(tmp_path):
    app, gateway, worker = make_app(tmp_path)
    with TestClient(app) as client:
        register(client, 'asr-owner@example.test')
        session = create_session(client); asset = audio(client, session)
        session = client.put(f'/api/interview-sessions/{session["id"]}', json={'base_lock_version': session['lock_version'], 'questions_markdown': '原手写内容'}).json()['session']
        request_id = str(uuid4())
        response = start(client, session, asset, request_id)
        assert response.status_code == 202, response.text
        assert set(response.json()['task']) == {'id','dataset_id','status','text','sentences','duration_ms','error_code','created_at','updated_at','completed_at'}
        assert start(client, session, asset, request_id).status_code == 200
        assert start(client, session, asset).json()['task']['id'] == response.json()['task']['id']
        assert asyncio.run(worker.run_once())
        assert len(gateway.submits) == 1
        target, source = gateway.submits[0]
        assert 'minio' not in source and target.model == 'fun-asr'
        token = source.split('token=')[1]
        downloaded = client.get('/api/interview-asr/audio', params={'token': token}, headers={'Range': 'bytes=0-9', 'Accept-Encoding': 'gzip'})
        assert downloaded.status_code == 206 and downloaded.content == probe_wav()[:10]
        assert downloaded.headers['content-encoding'] == 'identity'
        assert downloaded.headers['content-range'] == f'bytes 0-9/{len(probe_wav())}'
        assert client.head('/api/interview-asr/audio', params={'token': token}).headers['content-length'] == str(len(probe_wav()))
        assert client.get('/api/interview-asr/audio', params={'token': token}, headers={'Range': 'bytes=999999-'}).status_code == 416
        assert client.get('/api/interview-asr/audio', params={'token': token+'tamper'}).status_code == 404
        due(app)
        # Simulates a different worker instance after a restart.
        restarted = InterviewTranscriptionProcessor(session_factory=app.state.session_factory, settings=app.state.settings, llm_service=app.state.llm_service)
        assert asyncio.run(restarted.run_once())
        assert gateway.polls == ['supplier-task-1'] and len(gateway.submits) == 1
        latest = client.get(f'/api/interview-sessions/{session["id"]}/assets/{asset["id"]}/transcription').json()['task']
        assert latest['status'] == 'ready' and latest['text'].startswith('问：')
        with app.state.session_factory() as db:
            assert db.get(InterviewSession, int(session['id'])).questions_markdown == '原手写内容'
            log = db.scalar(select(LLMCallLog))
            assert log.status == 'succeeded' and log.usage_json == {'audio_seconds': 4}
        assert client.get('/api/interview-asr/audio', params={'token': token}).status_code == 404
        saved = client.put(f'/api/interview-sessions/{session["id"]}', json={'base_lock_version': session['lock_version'], 'questions_markdown': '原手写内容\n\n'+latest['text']})
        assert saved.status_code == 200
        assert saved.json()['session']['questions_markdown'].startswith('原手写内容\n\n问：')


@pytest.mark.parametrize('phase', ['before_submit','during_submit','after_submit'])
def test_cancel_fences_late_results_and_blocks_file_deletion_while_active(tmp_path, phase):
    app, gateway, worker = make_app(tmp_path)
    with TestClient(app) as client:
        register(client, 'cancel-owner@example.test'); session=create_session(client); asset=audio(client,session)
        task = start(client,session,asset).json()['task']
        with app.state.session_factory() as db:
            assert 'ai' in active_types(db, db.scalar(select(User.id)))
        assert client.delete(f'/api/datasets/{asset["id"]}').status_code == 409
        step = None
        if phase == 'during_submit': step = worker._claim()
        if phase == 'after_submit': assert asyncio.run(worker.run_once())
        response = client.post(f'/api/interview-sessions/{session["id"]}/assets/{asset["id"]}/transcription/cancel', json={'task_id':task['id']})
        assert response.status_code == 200 and response.json()['task']['status'] == 'cancelled'
        if step: worker._save(step, provider_id='late-supplier-id')
        assert not asyncio.run(worker.run_once())
        with app.state.session_factory() as db:
            current=db.get(DatasetTranscriptionTask,int(task['id']))
            assert current.status == 'cancelled' and current.lease_token is None
            assert current.provider_task_id == ('supplier-task-1' if phase == 'after_submit' else None)
            assert not active_types(db, current.user_id)
            assert all(log.status == 'cancelled' for log in db.scalars(select(LLMCallLog)))
        assert client.delete(f'/api/datasets/{asset["id"]}').status_code == 200
        with app.state.session_factory() as db:
            assert db.get(DatasetTranscriptionTask,int(task['id'])) is None


def test_unknown_submission_is_failed_without_repeating_paid_post(tmp_path):
    app,gateway,worker=make_app(tmp_path)
    with TestClient(app) as client:
        register(client,'uncertain@example.test'); session=create_session(client); asset=audio(client,session)
        start(client,session,asset)
        step=worker._claim(); assert step.submit
        assert worker._claim() is None  # Existing lease prevents another worker POST.
        due(app)
        assert not asyncio.run(worker.run_once())
        with app.state.session_factory() as db:
            task=db.scalar(select(DatasetTranscriptionTask)); log=db.scalar(select(LLMCallLog))
            assert task.status == 'failed' and task.error_code.endswith('SUBMIT_UNCERTAIN') and log.status == 'failed'
        assert not gateway.submits


def test_poll_transient_retry_reuses_provider_id_and_unlink_cancels(tmp_path):
    app,gateway,worker=make_app(tmp_path)
    with TestClient(app) as client:
        register(client,'retry@example.test'); session=create_session(client); asset=audio(client,session)
        start(client,session,asset); asyncio.run(worker.run_once()); due(app)
        gateway.error=FileTranscriptionError('PROVIDER_UNAVAILABLE',transient=True)
        asyncio.run(worker.run_once())
        assert not asyncio.run(worker.run_once())
        due(app); gateway.error=None; gateway.status='running'; asyncio.run(worker.run_once())
        assert len(gateway.submits)==1 and gateway.polls==['supplier-task-1']*2
        assert client.delete(f'/api/interview-sessions/{session["id"]}/assets/{asset["id"]}').status_code==200
        with app.state.session_factory() as db:
            task=db.scalar(select(DatasetTranscriptionTask)); assert task.status=='cancelled'
            assert db.get(UserDataset,int(asset['id'])).interview_session_id is None


def test_unconfigured_ownership_request_conflict_and_one_active_admission(tmp_path):
    app,gateway,worker=make_app(tmp_path,configured=False)
    with TestClient(app) as client:
        register(client,'admission@example.test'); session=create_session(client); asset=audio(client,session)
        cap=client.get(f'/api/interview-sessions/{session["id"]}/transcription-capability').json()
        assert cap=={'available':False,'error_code':'INTERVIEW_TRANSCRIPTION_MODEL_UNAVAILABLE'}
        assert start(client,session,asset).status_code==503
        app.state.settings.asr_media_base_url=None
        assert start(client,session,asset).json()['error']=='INTERVIEW_TRANSCRIPTION_MEDIA_UNAVAILABLE'
        assert start(client,{'id':'0001'},asset).status_code==404
        assert not gateway.submits


def test_task_is_private_and_signed_probe_cannot_read_personal_media(tmp_path):
    app,gateway,worker=make_app(tmp_path)
    with TestClient(app) as client:
        register(client,'private@example.test'); session=create_session(client); asset=audio(client,session); start(client,session,asset)
        token=audio_url(app.state.settings).split('token=')[1]
        assert client.get('/api/interview-asr/audio',params={'token':token}).content==probe_wav()
        client.post('/api/auth/logout')
        register(client,'other@example.test')
        assert client.get(f'/api/interview-sessions/{session["id"]}/assets/{asset["id"]}/transcription').status_code==404
        assert start(client,session,asset).status_code==404
        assert client.get('/api/interview-asr/audio',params={'token':'invalid'}).status_code==404


def test_admission_is_one_active_per_user_and_uuid_is_bound_to_one_file(tmp_path):
    app,gateway,worker=make_app(tmp_path)
    with TestClient(app) as client:
        register(client,'one-active@example.test'); session=create_session(client)
        first=audio(client,session); second=audio(client,session); request_id=str(uuid4())
        assert start(client,session,first,request_id).status_code==202
        assert start(client,session,second,request_id).json()['error']=='INTERVIEW_TRANSCRIPTION_REQUEST_CONFLICT'
        response=start(client,session,second)
        assert response.status_code==429 and response.json()['error']=='INTERVIEW_TRANSCRIPTION_BUSY'
        assert not gateway.submits


def test_admin_file_probe_uses_separate_gateway_and_requires_media_origin(tmp_path):
    app,gateway,worker=make_app(tmp_path)
    with TestClient(app) as client:
        register(client,'probe-admin@example.test')
        with app.state.session_factory() as db:
            db.scalar(select(User)).is_admin=True
            binding=db.scalar(select(LLMUseCaseRoute)); binding.validated_fingerprint=None
            route_id=binding.route_id; db.commit()
        path=f'/api/admin/llm/use-cases/recording_transcription/routes/{route_id}/probe'
        app.state.settings.asr_media_base_url=None
        assert client.post(path).json()['error']=='INTERVIEW_TRANSCRIPTION_MEDIA_UNAVAILABLE'
        assert not gateway.submits
        app.state.settings.asr_media_base_url='https://audio.example.test'
        response=client.post(path)
        assert response.status_code==200 and response.json()['validated'] is True
        assert 'interview-asr/audio?token=' in gateway.submits[0][1]
        with app.state.session_factory() as db:
            assert db.scalar(select(LLMUseCaseRoute)).validated_fingerprint is not None
            assert db.scalar(select(LLMCallLog)).use_case=='recording_transcription'
        # Probe input is fixed silence, independent from users' recordings.
        token=gateway.submits[0][1].split('token=')[1]
        assert client.get('/api/interview-asr/audio',params={'token':token}).content==probe_wav()


@pytest.mark.parametrize('change',['archive','cancel_session','delete_session'])
def test_session_lifecycle_invalidates_active_transcription_without_erasing_source(tmp_path,change):
    app,gateway,worker=make_app(tmp_path)
    with TestClient(app) as client:
        register(client,'lifecycle@example.test'); session=create_session(client); asset=audio(client,session)
        task=start(client,session,asset).json()['task']; assert asyncio.run(worker.run_once())
        if change=='archive':
            application=client.get(f'/api/job-applications/{session["application_id"]}').json()['application']
            response=client.post(f'/api/job-applications/{application["id"]}/archive',json={'base_lock_version':application['lock_version']})
        elif change=='cancel_session':
            response=client.post(f'/api/interview-sessions/{session["id"]}/cancel',json={'base_lock_version':session['lock_version'],'reason':'取消虚构安排'})
        else:
            response=client.delete(f'/api/interview-sessions/{session["id"]}')
        assert response.status_code in (200,204),response.text
        with app.state.session_factory() as db:
            current=db.get(DatasetTranscriptionTask,int(task['id']))
            assert current.status=='cancelled' and current.result_json is None
            assert db.get(UserDataset,int(asset['id'])) is not None
            assert db.scalar(select(LLMCallLog)).status=='cancelled'
        assert not asyncio.run(worker.run_once())


@pytest.mark.parametrize('failure',['configuration_changed','overall_deadline','expired_writer'])
def test_recovery_never_accepts_an_invalid_or_expired_write(tmp_path,failure):
    app,gateway,worker=make_app(tmp_path)
    with TestClient(app) as client:
        register(client,'recovery@example.test'); session=create_session(client); asset=audio(client,session)
        start(client,session,asset)
        if failure=='expired_writer':
            step=worker._claim()
            due(app)
            worker._save(step,provider_id='late-id')
            assert not asyncio.run(worker.run_once())
        else:
            assert asyncio.run(worker.run_once())
            with app.state.session_factory() as db:
                task=db.scalar(select(DatasetTranscriptionTask))
                task.updated_at=utc_now()-timedelta(minutes=6)
                if failure=='overall_deadline': task.created_at=utc_now()-timedelta(hours=24)
                else: db.scalar(select(LLMProviderConnection)).runtime_config_version+=1
                db.commit()
            assert not asyncio.run(worker.run_once())
        with app.state.session_factory() as db:
            task=db.scalar(select(DatasetTranscriptionTask));log=db.scalar(select(LLMCallLog))
            expected={'configuration_changed':'CONFIG_CHANGED','overall_deadline':'EXPIRED','expired_writer':'SUBMIT_UNCERTAIN'}[failure]
            assert task.status=='failed' and task.error_code=='INTERVIEW_TRANSCRIPTION_'+expected
            assert task.result_json is None and task.lease_token is None and log.status=='failed'
        assert len(gateway.submits)==(0 if failure=='expired_writer' else 1)


@pytest.mark.parametrize('phase',['submit','result'])
def test_step_timeout_bounds_slow_streams_without_resubmitting(tmp_path,monkeypatch,phase):
    app,gateway,worker=make_app(tmp_path)
    with TestClient(app) as client:
        register(client,'slow-stream@example.test');session=create_session(client);asset=audio(client,session)
        start(client,session,asset)
        original=getattr(gateway,phase)
        async def slow(*args,**kwargs):
            if phase=='submit': await original(*args,**kwargs)
            await asyncio.sleep(1)
        if phase=='result':
            assert asyncio.run(worker.run_once());due(app)
        setattr(gateway,phase,slow)
        monkeypatch.setattr('linkresume.workers.interview_transcription_worker.STEP_TIMEOUT_SECONDS',0.01)
        assert asyncio.run(worker.run_once())
        assert not asyncio.run(worker.run_once())
        with app.state.session_factory() as db:
            task=db.scalar(select(DatasetTranscriptionTask))
            assert task.status==('failed' if phase=='submit' else 'transcribing')
            assert task.error_code=='INTERVIEW_TRANSCRIPTION_'+('SUBMIT_UNCERTAIN' if phase=='submit' else 'PROVIDER_UNAVAILABLE')
            assert task.result_json is None and task.lease_token is None
        assert len(gateway.submits)==1


def test_expired_poll_claim_is_replaced_and_old_token_cannot_write(tmp_path):
    app,gateway,worker=make_app(tmp_path)
    with TestClient(app) as client:
        register(client,'lease-recovery@example.test');session=create_session(client);asset=audio(client,session)
        task=start(client,session,asset).json()['task']
        assert asyncio.run(worker.run_once());due(app)
        old=worker._claim();assert old and not old.submit
        path=f'/api/interview-sessions/{session["id"]}/assets/{asset["id"]}/transcription'
        before=client.get(path).json()['task']['updated_at']
        assert client.get(path).json()['task']['updated_at']==before
        assert worker._claim() is None
        with app.state.session_factory() as db:
            current=db.get(DatasetTranscriptionTask,int(task['id']))
            current.updated_at=utc_now()-timedelta(seconds=121)
            db.commit()
        new=worker._claim();assert new and new.lease!=old.lease
        result={'schema_version':1,'text':'张三校对前的识别稿','sentences':[],'duration_ms':4000}
        worker._save(old,result=result)
        with app.state.session_factory() as db:
            current=db.get(DatasetTranscriptionTask,int(task['id']))
            assert current.status=='transcribing' and current.result_json is None
            assert db.scalar(select(LLMCallLog)).status=='pending'
        worker._save(new,result=result)
        assert client.get(path).json()['task']['text']==result['text']
        assert len(gateway.submits)==1


@pytest.mark.parametrize('change',['unlink','legacy_unlink','delete_session','delete_application','delete_job'])
def test_relinking_recording_never_revives_old_task_or_call(tmp_path,change):
    app,gateway,worker=make_app(tmp_path)
    with TestClient(app) as client:
        register(client,'relink-recording@example.test');session=create_session(client);asset=audio(client,session)
        task=start(client,session,asset).json()['task'];assert asyncio.run(worker.run_once());due(app)
        late=worker._claim();assert late and not late.submit
        if change=='unlink':
            response=client.delete(f'/api/interview-sessions/{session["id"]}/assets/{asset["id"]}')
        elif change=='legacy_unlink':
            response=client.delete(f'/api/interview-assets/{asset["id"]}')
        elif change=='delete_session':
            response=client.delete(f'/api/interview-sessions/{session["id"]}')
        elif change=='delete_job':
            application=client.get(f'/api/job-applications/{session["application_id"]}').json()['application']
            response=client.delete(f'/api/job-descriptions/{application["job_description_id"]}')
        else:
            application=client.get(f'/api/job-applications/{session["application_id"]}').json()['application']
            terminated=client.post(f'/api/job-applications/{application["id"]}/terminate',json={
                'client_request_id':str(uuid4()),'reason':'company_rejected','base_lock_version':application['lock_version']})
            assert terminated.status_code==200,terminated.text
            response=client.delete(f'/api/job-applications/{application["id"]}')
        assert response.status_code in (200,204),response.text
        replacement=create_session(client)
        response=client.post(f'/api/interview-sessions/{replacement["id"]}/assets/attach',json={'dataset_id':asset['id']})
        assert response.status_code==201,response.text
        worker._save(late,result={'schema_version':1,'text':'旧场次晚到结果','sentences':[]})
        with app.state.session_factory() as db:
            current=db.get(DatasetTranscriptionTask,int(task['id']))
            assert current.status=='cancelled' and current.result_json is None
            assert db.get(UserDataset,int(asset['id'])).interview_session_id==int(replacement['id'])
            assert db.scalar(select(LLMCallLog)).status=='cancelled'
        assert start(client,replacement,asset).status_code==202


def test_request_ids_remain_user_scoped_and_reject_cross_owner_cancel(tmp_path):
    app,gateway,worker=make_app(tmp_path)
    request_id=str(uuid4())
    with TestClient(app) as client:
        register(client,'first-owner@example.test');first_session=create_session(client);first_asset=audio(client,first_session)
        first=start(client,first_session,first_asset,request_id).json()['task']
        client.post('/api/auth/logout');register(client,'second-owner@example.test')
        second_session=create_session(client);second_asset=audio(client,second_session)
        second=start(client,second_session,second_asset,request_id)
        assert second.status_code==202 and second.json()['task']['id']!=first['id']
        response=client.post(f'/api/interview-sessions/{second_session["id"]}/assets/{second_asset["id"]}/transcription/cancel',
                             json={'task_id':first['id']})
        assert response.status_code==404
        with app.state.session_factory() as db:
            assert db.get(DatasetTranscriptionTask,int(first['id'])).status=='queued'
