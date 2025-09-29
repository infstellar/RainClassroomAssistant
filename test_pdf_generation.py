#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试异步下载后PDF生成功能
"""

import os
import sys
import asyncio
import shutil
from pathlib import Path

# 添加Scripts目录到路径
sys.path.append(os.path.join(os.path.dirname(__file__), 'Scripts'))

from Scripts.Classes import Lesson
from Scripts.PPTManager import PPTManager

class MockSignal:
    """模拟信号类"""
    def __init__(self, callback):
        self.callback = callback
    
    def emit(self, *args, **kwargs):
        return self.callback(*args, **kwargs)

class MockMainUI:
    """模拟主UI类"""
    def __init__(self):
        # 模拟配置
        self.config = {
            'sessionid': 'test_session_id',
            'enable_ai_analysis': False,  # 禁用AI分析以简化测试
            'region': '0',  # 使用数字格式的region
        }
        
        # 模拟信号
        self.add_message_signal = MockSignal(self.add_message)
        self.add_course_signal = MockSignal(self.add_course)
        self.del_course_signal = MockSignal(self.del_course)
    
    def add_message(self, message, level):
        print(f"[UI] {message}")
    
    def add_course(self, *args):
        pass
    
    def del_course(self, *args):
        pass

async def test_async_pdf_generation():
    """测试异步下载后PDF生成功能"""
    print("开始测试异步下载后PDF生成功能...")
    
    # 创建测试数据
    test_data = {
        "title": "测试章节PDF生成",
        "slides": [
            {
                "index": 1,
                "cover": "https://via.placeholder.com/800x600/FF0000/FFFFFF?text=Slide+1",
                "problem": {"answers": [1, 2]}
            },
            {
                "index": 2,
                "cover": "https://via.placeholder.com/800x600/00FF00/FFFFFF?text=Slide+2",
                "problem": {"answers": [3, 4]}
            }
        ],
        "width": 800,
        "height": 600
    }
    
    # 创建模拟的Lesson实例
    mock_ui = MockMainUI()
    lesson = Lesson("test_lesson_id", "测试课程", "test_classroom_id", mock_ui)
    
    try:
        # 执行异步下载（包含PDF生成）
        await lesson._async_download(test_data)
        
        # 检查PDF是否生成
        expected_pdf_path = os.path.join("downloads", "rainclasscache", "测试课程", "测试章节PDF生成.pdf")
        
        if os.path.exists(expected_pdf_path):
            print(f"✅ PDF生成成功: {expected_pdf_path}")
            print(f"   文件大小: {os.path.getsize(expected_pdf_path)} bytes")
            return True
        else:
            print(f"❌ PDF生成失败: 未找到文件 {expected_pdf_path}")
            
            # 检查可能的其他位置
            search_paths = [
                os.path.join("downloads", "测试章节PDF生成.pdf"),
                os.path.join("downloads", "rainclasscache", "测试章节PDF生成.pdf"),
            ]
            
            for path in search_paths:
                if os.path.exists(path):
                    print(f"   但在其他位置找到PDF: {path}")
                    return True
            
            return False
            
    except Exception as e:
        print(f"❌ 测试过程中发生错误: {e}")
        import traceback
        traceback.print_exc()
        return False

def cleanup_test_files():
    """清理测试文件"""
    print("清理测试文件...")
    test_dirs = [
        "downloads/rainclasscache/测试课程",
        "downloads/测试章节PDF生成",
    ]
    
    for test_dir in test_dirs:
        if os.path.exists(test_dir):
            try:
                shutil.rmtree(test_dir)
                print(f"已删除测试目录: {test_dir}")
            except Exception as e:
                print(f"删除测试目录失败 {test_dir}: {e}")

async def main():
    """主测试函数"""
    print("=" * 50)
    print("异步下载PDF生成功能测试")
    print("=" * 50)
    
    # 执行测试
    success = await test_async_pdf_generation()
    
    print("\n" + "=" * 50)
    if success:
        print("✅ 测试通过: 异步下载后PDF生成功能正常")
    else:
        print("❌ 测试失败: 异步下载后PDF生成功能异常")
    print("=" * 50)
    
    # 清理测试文件
    cleanup_test_files()
    
    return success

if __name__ == "__main__":
    # 运行测试
    result = asyncio.run(main())
    sys.exit(0 if result else 1)