#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试用户信息获取bug修复
验证Classes.py中的TypeError修复是否有效
"""

import sys
import os
import unittest
from unittest.mock import Mock, patch

# 添加Scripts目录到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'Scripts'))

class TestUserInfoFix(unittest.TestCase):
    """测试用户信息获取的错误处理"""
    
    def setUp(self):
        """设置测试环境"""
        # 模拟主UI对象
        self.mock_main_ui = Mock()
        self.mock_main_ui.config = {
            "sessionid": "test_session",
            "region": "1"
        }
        self.mock_main_ui.add_message_signal.emit = Mock()
        
    @patch('Scripts.Classes.get_user_info')
    def test_successful_user_info(self, mock_get_user_info):
        """测试正常情况下的用户信息获取"""
        # 模拟正常返回
        mock_get_user_info.return_value = (0, {"id": "test_user", "name": "测试用户"})
        
        from Scripts.Classes import Lesson
        
        # 应该能正常创建Lesson对象
        lesson = Lesson("test_lesson", "测试课程", "test_classroom", self.mock_main_ui)
        
        self.assertEqual(lesson.user_uid, "test_user")
        self.assertEqual(lesson.user_uname, "测试用户")
        
    @patch('Scripts.Classes.get_user_info')
    def test_api_error_code(self, mock_get_user_info):
        """测试API返回错误代码的情况"""
        # 模拟API错误
        mock_get_user_info.return_value = (50000, "登录已过期")
        
        from Scripts.Classes import Lesson
        
        # 应该抛出ValueError
        with self.assertRaises(ValueError) as context:
            Lesson("test_lesson", "测试课程", "test_classroom", self.mock_main_ui)
        
        self.assertIn("获取用户信息失败", str(context.exception))
        
    @patch('Scripts.Classes.get_user_info')
    def test_string_return_value(self, mock_get_user_info):
        """测试返回字符串而不是字典的情况（原始bug场景）"""
        # 模拟返回字符串（这是导致原始TypeError的情况）
        mock_get_user_info.return_value = (0, "some_string_response")
        
        from Scripts.Classes import Lesson
        
        # 应该抛出ValueError而不是TypeError
        with self.assertRaises(ValueError) as context:
            Lesson("test_lesson", "测试课程", "test_classroom", self.mock_main_ui)
        
        self.assertIn("获取用户信息失败", str(context.exception))
        
    @patch('Scripts.Classes.get_user_info')
    def test_missing_required_fields(self, mock_get_user_info):
        """测试返回的字典缺少必要字段的情况"""
        # 模拟返回缺少字段的字典
        mock_get_user_info.return_value = (0, {"some_field": "value"})
        
        from Scripts.Classes import Lesson
        
        # 应该抛出ValueError
        with self.assertRaises(ValueError) as context:
            Lesson("test_lesson", "测试课程", "test_classroom", self.mock_main_ui)
        
        self.assertIn("用户信息格式错误", str(context.exception))
        
    @patch('Scripts.Classes.get_user_info')
    def test_partial_fields(self, mock_get_user_info):
        """测试只有部分必要字段的情况"""
        # 模拟只有id没有name
        mock_get_user_info.return_value = (0, {"id": "test_user"})
        
        from Scripts.Classes import Lesson
        
        # 应该抛出ValueError
        with self.assertRaises(ValueError) as context:
            Lesson("test_lesson", "测试课程", "test_classroom", self.mock_main_ui)
        
        self.assertIn("用户信息格式错误", str(context.exception))

def run_tests():
    """运行所有测试"""
    print("🧪 开始测试用户信息获取bug修复...")
    
    # 创建测试套件
    suite = unittest.TestLoader().loadTestsFromTestCase(TestUserInfoFix)
    
    # 运行测试
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # 输出结果
    if result.wasSuccessful():
        print("✅ 所有测试通过！用户信息获取bug修复成功。")
        return True
    else:
        print("❌ 测试失败！")
        for failure in result.failures:
            print(f"失败: {failure[0]}")
            print(f"详情: {failure[1]}")
        for error in result.errors:
            print(f"错误: {error[0]}")
            print(f"详情: {error[1]}")
        return False

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)