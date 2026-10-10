"""Only runs against the explicitly configured disposable local MySQL database."""
from decimal import Decimal

from sqlalchemy import create_engine, inspect, text

from drawoffer.modules.llm.models import LLMPriceRevision, LLMCostOperation, LLMCallCostRevision
from tests.integration.migrations.test_mysql_migrations import migration_test_url, reset_test_database_to_base, run_alembic


def test_empty_and_0115_upgrade_preserve_cost_evidence():
    url = migration_test_url()
    reset_test_database_to_base(url)
    run_alembic(url, "upgrade", "head")
    engine = create_engine(url)
    inspector = inspect(engine)
    for model in (LLMPriceRevision, LLMCostOperation, LLMCallCostRevision):
        assert {c["name"] for c in inspector.get_columns(model.__tablename__)} == set(model.__table__.columns.keys())
        assert inspector.get_foreign_keys(model.__tablename__) == []
        expected = {c.name for c in model.__table__.constraints if c.name} | {i.name for i in model.__table__.indexes}
        actual = {c["name"] for c in inspector.get_unique_constraints(model.__tablename__)} | {i["name"] for i in inspector.get_indexes(model.__tablename__)}
        assert expected <= actual
    with engine.connect() as db:
        assert db.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0116"
    engine.dispose()
    reset_test_database_to_base(url)
    run_alembic(url, "upgrade", "0115")
    engine = create_engine(url)
    with engine.begin() as db:
        db.execute(text("INSERT INTO llm_provider_connection (id,provider_code,name) VALUES (1,'aihubmix','fictional-cost-provider')"))
        db.execute(text("INSERT INTO llm_model (id,display_name) VALUES (1,'fictional-cost-model')"))
        db.execute(text("INSERT INTO llm_model_route (id,model_id,connection_id,target_kind,invoke_target,origin,pricing_json) VALUES (1,1,1,'model','fictional-cost-target','manual',JSON_OBJECT('currency','USD','input_per_million','1','output_per_million','2'))"))
        db.execute(text("INSERT INTO llm_call_log (call_id,use_case,source,route_id,runtime_config_version,protocol_code,selection_source,status,estimated_cost,cost_currency,create_time,price_snapshot_json,usage_json) VALUES ('fictional-cost-call','assistant_conversation','fixture',1,1,'openai_chat','default','succeeded',0.0001234567,'USD','2026-10-06 08:00:00',JSON_OBJECT('input_per_million','1'),JSON_OBJECT('cacheRead',10))"))
    run_alembic(url, "upgrade", "head")
    with engine.connect() as db:
        row = db.execute(text("SELECT estimated_cost,cost_currency,create_time,price_snapshot_json,usage_json,request_started_at FROM llm_call_log WHERE call_id='fictional-cost-call'")).one()
        assert row.estimated_cost == Decimal(".0001234567") and row.cost_currency == "USD"
        assert row.create_time.hour == 8 and row.request_started_at is None
        assert "input_per_million" in row.price_snapshot_json and "cacheRead" in row.usage_json
        assert db.execute(text("SELECT pricing_mode FROM llm_model_route WHERE id=1")).scalar() == "manual_override"
    engine.dispose()
