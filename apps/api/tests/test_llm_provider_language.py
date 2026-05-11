from app.core.llm_provider import build_visible_language_instruction


def test_visible_language_instruction_uses_chinese_for_chinese_user_message():
    instruction = build_visible_language_instruction("查一下杭州最近一周的天气")

    assert "中文" in instruction
    assert "可见思考过程" in instruction
    assert "工具名、URL、代码" in instruction


def test_visible_language_instruction_does_not_force_chinese_for_english_message():
    assert build_visible_language_instruction("Check the weather in Hangzhou") == ""


def test_visible_language_instruction_respects_explicit_english_request():
    assert build_visible_language_instruction("用英文回答：杭州天气怎么样？") == ""
