"""Career profiles enter AI materials only through an owned, fresh selection."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from drawoffer.core.errors import ApiError
from drawoffer.modules.agent.context_service import list_contexts, resolve_contexts
from drawoffer.modules.agent.schemas import AgentContextRef
from drawoffer.modules.identity.models import UserProfile
from tests.integration.api.test_account_routes import build_test_app, _valid_profile_payload
from tests.integration.api.test_account_completion import register


def test_profile_is_explicit_owned_versioned_material_and_does_not_modify_resume():
    app = build_test_app()
    with TestClient(app) as client:
        uid = register(client)
        saved_resume = client.post("/api/resumes", json={"title": "张三的示例简历", "template_id": app.state.test_template_id}).json()["resume"]
        saved = client.put("/api/account/user-profile", json=_valid_profile_payload()).json()
        with app.state.session_factory() as db:
            profile = db.scalar(select(UserProfile).where(UserProfile.user_id == uid))
            profile.school_tier = ["本科", "project_985"]
            db.commit()
        assert client.get(f"/api/resumes/{saved_resume['id']}").json()["resume"] == saved_resume
        with app.state.session_factory() as db:
            empty = resolve_contexts(db, user_id=uid, refs=[], storage=app.state.storage, settings=app.state.settings)
            assert empty.materials == []
            options = list_contexts(db, user_id=uid, context_type="user_profile")
            assert len(options) == 1
            assert "React" not in options[0].model_dump_json()
            ref = AgentContextRef(type="user_profile", id=str(uid), version=str(saved["lock_version"]))
            selected = resolve_contexts(db, user_id=uid, refs=[ref], storage=app.state.storage, settings=app.state.settings)
            assert selected.snapshots[0].type == "user_profile"
            assert list(selected.materials[0].content) == ["profile_markdown"]
            assert "React" in selected.materials[0].content["profile_markdown"]
            assert '- school_tier: ["project_985"]' in selected.materials[0].content["profile_markdown"]
            assert '- education_level: "bachelor"' in selected.materials[0].content["profile_markdown"]
            assert "本科" not in selected.materials[0].content["profile_markdown"]
            assert "account@example.com" not in selected.materials[0].content["profile_markdown"]
            assert "password" not in selected.materials[0].content["profile_markdown"]
        client.put("/api/account/user-profile", json=_valid_profile_payload(base_lock_version=saved["lock_version"]))
        with app.state.session_factory() as db:
            with pytest.raises(ApiError) as stale:
                resolve_contexts(db, user_id=uid, refs=[ref], storage=app.state.storage, settings=app.state.settings)
            assert stale.value.code == "AGENT_CONTEXT_STALE"
        with app.state.session_factory() as db:
            with pytest.raises(ApiError) as other:
                resolve_contexts(db, user_id=uid, refs=[AgentContextRef(type="user_profile", id=str(uid+1), version="1")], storage=app.state.storage, settings=app.state.settings)
            assert other.value.code == "AGENT_CONTEXT_NOT_FOUND"
