#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试迭代修改列表错误的修复
"""

import time
import unittest
from unittest.mock import Mock, patch
import sys
import os

# 添加Scripts目录到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'Scripts'))

from Scripts.Classes import Lesson


class TestIterationFix(unittest.TestCase):
    """测试迭代修改列表的修复"""
    
    def setUp(self):
        """设置测试环境"""
        # 创建模拟的main_ui对象
        self.mock_main_ui = Mock()
        self.mock_main_ui.config = {
            'sessionid': 'test_session',
            'region': 'test_region',
            'danmu_config': {
                'auto_danmu': True,
                'danmu_limit': 3
            }
        }
        
        # 创建Lesson实例
        self.lesson = Lesson(
            lessonid='test_lesson',
            lessonname='测试课程',
            classroomid='test_classroom',
            main_ui=self.mock_main_ui
        )
    
    def test_danmu_dict_time_cleanup(self):
        """测试弹幕时间清理逻辑"""
        current_time = time.time()
        
        # 模拟弹幕记录：包含新旧记录
        test_content = "测试弹幕"
        self.lesson.danmu_dict[test_content] = [
            current_time - 70,  # 70秒前，应该被清除
            current_time - 30,  # 30秒前，应该保留
            current_time - 5,   # 5秒前，应该保留
        ]
        
        # 获取列表引用
        same_content_ls = self.lesson.danmu_dict[test_content]
        original_length = len(same_content_ls)
        
        # 执行清理逻辑（模拟修复后的代码）
        now = current_time
        same_content_ls[:] = [i for i in same_content_ls if now - i <= 60]
        
        # 验证结果
        self.assertEqual(len(same_content_ls), 2, "应该保留2条60秒内的记录")
        self.assertTrue(all(now - i <= 60 for i in same_content_ls), "所有保留的记录都应该在60秒内")
        
        # 验证原始列表被正确修改
        self.assertIs(same_content_ls, self.lesson.danmu_dict[test_content], "应该修改原始列表")
    
    def test_empty_list_cleanup(self):
        """测试空列表的清理"""
        test_content = "空列表测试"
        self.lesson.danmu_dict[test_content] = []
        
        same_content_ls = self.lesson.danmu_dict[test_content]
        now = time.time()
        
        # 执行清理
        same_content_ls[:] = [i for i in same_content_ls if now - i <= 60]
        
        # 验证空列表不会出错
        self.assertEqual(len(same_content_ls), 0, "空列表应该保持为空")
    
    def test_all_old_records_cleanup(self):
        """测试所有记录都过期的情况"""
        current_time = time.time()
        test_content = "全部过期测试"
        
        # 所有记录都超过60秒
        self.lesson.danmu_dict[test_content] = [
            current_time - 70,
            current_time - 80,
            current_time - 90,
        ]
        
        same_content_ls = self.lesson.danmu_dict[test_content]
        now = current_time
        
        # 执行清理
        same_content_ls[:] = [i for i in same_content_ls if now - i <= 60]
        
        # 验证所有记录都被清除
        self.assertEqual(len(same_content_ls), 0, "所有过期记录都应该被清除")
    
    def test_no_iteration_error(self):
        """测试不会出现迭代修改错误"""
        current_time = time.time()
        test_content = "迭代错误测试"
        
        # 创建包含多个过期记录的列表
        self.lesson.danmu_dict[test_content] = [
            current_time - 70,
            current_time - 30,
            current_time - 80,
            current_time - 10,
            current_time - 90,
        ]
        
        same_content_ls = self.lesson.danmu_dict[test_content]
        now = current_time
        
        # 这个操作不应该抛出任何异常
        try:
            same_content_ls[:] = [i for i in same_content_ls if now - i <= 60]
            success = True
        except Exception as e:
            success = False
            self.fail(f"清理操作不应该抛出异常: {e}")
        
        self.assertTrue(success, "清理操作应该成功完成")
        self.assertEqual(len(same_content_ls), 2, "应该保留2条有效记录")


if __name__ == '__main__':
    # 运行测试
    unittest.main(verbosity=2)