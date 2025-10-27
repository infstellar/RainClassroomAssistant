#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试presentation字段缺失的修复
"""

import json
import sys
import os

# 添加Scripts目录到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'Scripts'))

from Scripts.Classes import Lesson
from Scripts.Utils import dict_result

class MockMainUI:
    """模拟主UI类"""
    def __init__(self):
        self.config = {
            "sessionid": "test_session",
            "region": "cn",
            "auto_danmu": False,
            "auto_answer": False,
            "danmu_config": {"danmu_limit": 3}
        }
        self.messages = []
    
    class MockSignal:
        def emit(self, *args):
            pass
    
    add_message_signal = MockSignal()
    add_course_signal = MockSignal()
    del_course_signal = MockSignal()

class MockWebSocketApp:
    """模拟WebSocket应用"""
    def close(self):
        pass

def test_presentation_missing():
    """测试presentation字段缺失的情况"""
    print("开始测试presentation字段缺失的修复...")
    
    try:
        # 创建模拟的主UI
        mock_ui = MockMainUI()
        
        # 创建Lesson实例（这里会因为网络请求失败，但我们主要测试on_message方法）
        try:
            lesson = Lesson("test_lesson", "测试课程", "test_classroom", mock_ui)
        except Exception as e:
            print(f"创建Lesson实例失败（预期的）: {e}")
            # 手动创建一个简化的lesson对象用于测试
            lesson = object.__new__(Lesson)
            lesson.lessonname = "测试课程"
            lesson.add_message = lambda msg, level: print(f"[{level}] {msg}")
            lesson.config = mock_ui.config
            lesson.problems_ls = []
            lesson.problems_dict = {}
            lesson.unlocked_problem = []
            lesson.get_problems = lambda x: []
            lesson.download_ppt = lambda x: None
            lesson._current_problem = lambda x, y: None
        
        # 测试缺少presentation字段的hello消息
        test_message_1 = {
            "op": "hello",
            "timeline": [
                {"type": "slide", "pres": "pres1"},
                {"type": "slide", "pres": "pres2"}
            ]
            # 注意：这里故意不包含"presentation"字段
        }
        
        print("\n测试1: hello消息缺少presentation字段")
        mock_ws = MockWebSocketApp()
        lesson.on_message(mock_ws, json.dumps(test_message_1))
        
        # 测试缺少presentation字段的presentationupdated消息
        test_message_2 = {
            "op": "presentationupdated"
            # 注意：这里故意不包含"presentation"字段
        }
        
        print("\n测试2: presentationupdated消息缺少presentation字段")
        lesson.on_message(mock_ws, json.dumps(test_message_2))
        
        # 测试缺少presentation字段的presentationcreated消息
        test_message_3 = {
            "op": "presentationcreated"
            # 注意：这里故意不包含"presentation"字段
        }
        
        print("\n测试3: presentationcreated消息缺少presentation字段")
        lesson.on_message(mock_ws, json.dumps(test_message_3))
        
        # 测试正常包含presentation字段的消息
        test_message_4 = {
            "op": "hello",
            "timeline": [
                {"type": "slide", "pres": "pres1"}
            ],
            "presentation": "current_pres",
            "unlockedproblem": []
        }
        
        print("\n测试4: hello消息包含presentation字段（正常情况）")
        lesson.on_message(mock_ws, json.dumps(test_message_4))
        
        print("\n✓ 所有测试完成，修复方案工作正常！")
        
    except Exception as e:
        print(f"✗ 测试失败: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_presentation_missing()