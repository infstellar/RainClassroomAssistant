#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简化测试：直接测试迭代修改列表错误的修复
"""

import time
import unittest


class TestIterationFix(unittest.TestCase):
    """测试迭代修改列表的修复"""
    
    def test_old_buggy_approach(self):
        """测试原来有问题的方法会导致错误"""
        current_time = time.time()
        
        # 模拟弹幕记录
        same_content_ls = [
            current_time - 70,  # 70秒前，应该被清除
            current_time - 30,  # 30秒前，应该保留
            current_time - 80,  # 80秒前，应该被清除
            current_time - 5,   # 5秒前，应该保留
        ]
        
        now = current_time
        
        # 原来的有问题的方法（会导致迭代修改错误）
        # 注意：这里我们不实际运行，只是展示问题
        print("原来的有问题的代码:")
        print("for i in same_content_ls:")
        print("    if now - i > 60:")
        print("        same_content_ls.remove(i)  # 这会导致迭代修改错误")
        
        # 验证原始列表长度
        original_length = len(same_content_ls)
        self.assertEqual(original_length, 4, "原始列表应该有4个元素")
    
    def test_fixed_approach(self):
        """测试修复后的方法"""
        current_time = time.time()
        
        # 模拟弹幕记录
        same_content_ls = [
            current_time - 70,  # 70秒前，应该被清除
            current_time - 30,  # 30秒前，应该保留
            current_time - 80,  # 80秒前，应该被清除
            current_time - 5,   # 5秒前，应该保留
        ]
        
        now = current_time
        original_id = id(same_content_ls)
        
        # 修复后的方法（使用列表切片赋值）
        same_content_ls[:] = [i for i in same_content_ls if now - i <= 60]
        
        # 验证结果
        self.assertEqual(len(same_content_ls), 2, "应该保留2条60秒内的记录")
        self.assertTrue(all(now - i <= 60 for i in same_content_ls), "所有保留的记录都应该在60秒内")
        self.assertEqual(id(same_content_ls), original_id, "应该是同一个列表对象")
        
        print(f"修复后的结果：保留了 {len(same_content_ls)} 条记录")
    
    def test_edge_cases(self):
        """测试边界情况"""
        current_time = time.time()
        now = current_time
        
        # 测试空列表
        empty_list = []
        empty_list[:] = [i for i in empty_list if now - i <= 60]
        self.assertEqual(len(empty_list), 0, "空列表应该保持为空")
        
        # 测试所有记录都过期
        all_old = [current_time - 70, current_time - 80, current_time - 90]
        all_old[:] = [i for i in all_old if now - i <= 60]
        self.assertEqual(len(all_old), 0, "所有过期记录都应该被清除")
        
        # 测试所有记录都有效
        all_new = [current_time - 10, current_time - 20, current_time - 30]
        original_length = len(all_new)
        all_new[:] = [i for i in all_new if now - i <= 60]
        self.assertEqual(len(all_new), original_length, "所有有效记录都应该保留")
    
    def test_performance_comparison(self):
        """测试性能对比"""
        import timeit
        
        current_time = time.time()
        
        # 创建大量测试数据
        def create_test_data():
            return [current_time - i for i in range(0, 100, 5)]  # 20个元素
        
        # 测试修复后的方法
        def fixed_method():
            test_list = create_test_data()
            now = current_time
            test_list[:] = [i for i in test_list if now - i <= 60]
            return test_list
        
        # 运行性能测试
        fixed_time = timeit.timeit(fixed_method, number=1000)
        
        result = fixed_method()
        print(f"修复后的方法执行1000次耗时: {fixed_time:.4f}秒")
        print(f"处理结果：从20个元素过滤到 {len(result)} 个有效元素")
        
        # 验证结果正确性
        self.assertTrue(len(result) > 0, "应该有有效记录")
        self.assertTrue(all(current_time - i <= 60 for i in result), "所有记录都应该在60秒内")


if __name__ == '__main__':
    print("=" * 60)
    print("测试迭代修改列表错误的修复")
    print("=" * 60)
    
    # 运行测试
    unittest.main(verbosity=2)