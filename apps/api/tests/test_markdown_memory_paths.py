from app.core.memory_paths import (
    ensure_memory_profile,
    get_ai_native_home,
    get_memory_root,
    get_profile_memory_root,
    slugify_profile_id,
)


def test_ai_native_home_can_be_overridden_with_environment(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))

    assert get_ai_native_home() == home
    assert get_memory_root() == home / "memory"


def test_ensure_memory_profile_creates_directories_and_markdown_files(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))

    paths = ensure_memory_profile()

    assert paths.home == home
    assert paths.memory_root == home / "memory"
    assert paths.profile_id == "default"
    assert paths.profile_root == home / "memory"
    assert paths.memory_file == paths.profile_root / "MEMORY.md"
    assert paths.dreams_file == paths.profile_root / "DREAMS.md"
    assert paths.readme_file == paths.profile_root / "README.md"
    assert paths.daily_dir == paths.profile_root / "daily"
    assert paths.dreams_state_dir == paths.profile_root / ".dreams"
    assert paths.backups_dir == paths.dreams_state_dir / "backups"
    assert paths.migrations_dir == paths.dreams_state_dir / "migrations"
    assert paths.locks_dir == paths.dreams_state_dir / "locks"

    for directory in (
        paths.profile_root,
        paths.daily_dir,
        paths.dreams_state_dir,
        paths.backups_dir,
        paths.migrations_dir,
        paths.locks_dir,
    ):
        assert directory.is_dir()

    for markdown_file in (paths.memory_file, paths.dreams_file, paths.readme_file):
        assert markdown_file.is_file()
        assert markdown_file.read_text(encoding="utf-8")


def test_default_profile_uses_memory_root(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))

    assert slugify_profile_id(None) == "default"
    assert slugify_profile_id(" ._- ") == "default"
    assert get_profile_memory_root() == home / "memory"
    assert get_profile_memory_root("default") == home / "memory"


def test_non_default_profile_uses_slug_under_profiles(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))

    assert slugify_profile_id("Research Agent") == "research_agent"
    assert get_profile_memory_root("Research Agent") == (
        home / "memory" / "profiles" / "research_agent"
    )


def test_dangerous_profile_slug_stays_inside_memory_root(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))

    profile_root = get_profile_memory_root("../../evil")
    memory_root = get_memory_root()

    assert slugify_profile_id("../../evil") == "evil"
    assert profile_root == home / "memory" / "profiles" / "evil"
    assert profile_root.resolve().is_relative_to(memory_root.resolve())
