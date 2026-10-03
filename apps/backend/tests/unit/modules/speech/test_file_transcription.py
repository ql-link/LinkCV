import asyncio
import json

import httpx
import pytest

from linkresume.core.config import Settings
from linkresume.modules.llm.providers import file_asr_base_url, validate_use_case_protocol
from linkresume.modules.speech.file_transcription import AliyunFileTranscriptionGateway, FileTranscriptionTarget, FileTranscriptionError, normalize_result
from linkresume.modules.speech.media_token import audio_url, decode_audio_token

TARGET = FileTranscriptionTarget('https://fictional.cn-beijing.maas.aliyuncs.com/api/v1', 'fictional-key', 'fun-asr')
URL = 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.json?Signature=fictional'
RESULT = {'properties': {'original_duration_in_milliseconds': 4000}, 'transcripts': [{'channel_id': 0, 'text': '张三的虚构项目。', 'sentences': [{'text': '虚构项目。', 'begin_time': 1, 'end_time': 3000}]}]}


def test_supplier_submit_poll_and_result_contract_without_forwarding_key_to_result_host():
    calls=[]
    def respond(request):
        calls.append(request)
        if request.method=='POST':
            body=json.loads(request.content)
            assert body['input']['file_urls']==['https://audio.example.test/api/interview-asr/audio?token=fictional']
            assert body['parameters']=={'channel_id':[0]}
            assert request.headers['x-dashscope-async']=='enable'
            return httpx.Response(200,json={'output':{'task_id':'supplier-1','task_status':'PENDING'}})
        if request.url.path.startswith('/api/v1/tasks'):
            return httpx.Response(200,json={'output':{'task_status':'SUCCEEDED','results':[{'subtask_status':'SUCCEEDED','transcription_url':URL}]},'usage':{'duration':4}})
        assert 'authorization' not in request.headers
        return httpx.Response(200,json=RESULT)
    gateway=AliyunFileTranscriptionGateway(httpx.MockTransport(respond))
    async def run():
        task=await gateway.submit(TARGET,'https://audio.example.test/api/interview-asr/audio?token=fictional')
        polled=await gateway.poll(TARGET,task)
        return await gateway.result(TARGET,polled['url'])
    value=asyncio.run(run())
    assert value['text']=='张三的虚构项目。' and value['sentences'][0]['start_ms']==1
    assert len(calls)==3


def test_parent_success_with_failed_file_does_not_produce_a_draft():
    transport=httpx.MockTransport(lambda _: httpx.Response(200,json={'output':{'task_status':'SUCCEEDED','results':[{'subtask_status':'FAILED','message':'secret supplier response'}]}}))
    with pytest.raises(FileTranscriptionError,match='PROVIDER_FAILED'):
        asyncio.run(AliyunFileTranscriptionGateway(transport).poll(TARGET,'supplier-1'))


def test_no_auto_retry_on_submission_timeout():
    calls=[]
    def respond(request):
        calls.append(request); raise httpx.ReadTimeout('fictional',request=request)
    with pytest.raises(FileTranscriptionError):
        asyncio.run(AliyunFileTranscriptionGateway(httpx.MockTransport(respond)).submit(TARGET,'https://audio.example.test/source'))
    assert len(calls)==1


@pytest.mark.parametrize('url',['http://127.0.0.1/x','https://attacker.example/x','https://oss-cn-beijing.aliyuncs.com.evil.test/x','https://user:secret@bucket.oss-cn-beijing.aliyuncs.com/x','https://bucket.oss-ap-southeast-1.aliyuncs.com/x','https://bucket.oss-cn-beijing.aliyuncs.com:8000/x','https://bucket.oss-cn-beijing.aliyuncs.com:invalid/x'])
def test_result_url_policy_rejects_foreign_hosts_without_http(url):
    def forbidden(_): pytest.fail('unsafe URL must not be fetched')
    with pytest.raises(FileTranscriptionError,match='RESULT_URL_INVALID'):
        asyncio.run(AliyunFileTranscriptionGateway(httpx.MockTransport(forbidden)).result(TARGET,url))


def test_probe_allows_silence_but_user_draft_does_not_and_no_fake_timestamps():
    assert normalize_result({'transcripts':[]},allow_empty=True)['text']==''
    with pytest.raises(FileTranscriptionError): normalize_result({'transcripts':[]})
    assert normalize_result({'transcripts':[{'text':'记录原文','sentences':[{'text':'缺少时间'}]}]})['sentences']==[]


@pytest.mark.parametrize('url',['http://audio.example.test','https://localhost','https://10.0.0.1','https://audio.example.test/api','https://u:p@audio.example.test','https://audio.example.test?token=x'])
def test_media_origin_validation(url):
    with pytest.raises(ValueError): Settings(asr_media_base_url=url)


def test_file_protocol_is_separate_from_realtime_and_token_is_purpose_bound():
    validate_use_case_protocol('recording_transcription','aliyun_asr_file')
    with pytest.raises(ValueError): validate_use_case_protocol('speech_to_text','aliyun_asr_file')
    assert file_asr_base_url({'region':'ap-southeast-1'}).startswith('https://dashscope-intl')
    settings=Settings(asr_media_base_url='https://audio.example.test')
    claims=decode_audio_token(settings,audio_url(settings).split('token=')[1])
    assert claims['purpose']=='probe' and 'sid' not in claims and 'sub' not in claims


def test_transient_result_download_failure_can_be_polled_again():
    def respond(request): raise httpx.ReadTimeout('fictional', request=request)
    with pytest.raises(FileTranscriptionError) as caught:
        asyncio.run(AliyunFileTranscriptionGateway(httpx.MockTransport(respond)).result(TARGET,URL))
    assert caught.value.transient
