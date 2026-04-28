import pytest

from app.api.v1 import skills


class FakeSkillRegistry:
    def __init__(self):
        self.upserts = []
        self.deleted = []

    def upsert_user_skill(self, skill_id, **kwargs):
        self.upserts.append((skill_id, kwargs))
        return {"id": skill_id, **kwargs}

    def delete_user_skill(self, skill_id):
        self.deleted.append(skill_id)


@pytest.mark.anyio
async def test_create_and_update_user_skill_use_registry(monkeypatch):
    registry = FakeSkillRegistry()
    monkeypatch.setattr(skills, "get_app_registry", lambda: registry)
    request = skills.SkillUpsertRequest(
        name="Stock Skill",
        description="Quote stocks",
        content="Use this skill for stock quotes.",
        enabled=True,
    )

    created = await skills.create_skill("stock", request)
    updated = await skills.update_skill("stock", request)

    assert created["id"] == "stock"
    assert updated["id"] == "stock"
    assert registry.upserts == [
        (
            "stock",
            {
                "name": "Stock Skill",
                "description": "Quote stocks",
                "content": "Use this skill for stock quotes.",
                "enabled": True,
            },
        ),
        (
            "stock",
            {
                "name": "Stock Skill",
                "description": "Quote stocks",
                "content": "Use this skill for stock quotes.",
                "enabled": True,
            },
        ),
    ]


@pytest.mark.anyio
async def test_delete_user_skill_uses_registry(monkeypatch):
    registry = FakeSkillRegistry()
    monkeypatch.setattr(skills, "get_app_registry", lambda: registry)

    result = await skills.delete_skill("stock")

    assert result == {"status": "deleted"}
    assert registry.deleted == ["stock"]
