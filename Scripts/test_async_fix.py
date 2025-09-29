#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
测试异步下载修复
"""

import asyncio
import tempfile
import os
import shutil
from AsyncDownloader import AsyncPPTDownloadManager

def test_async_ppt_download_manager():
    """测试AsyncPPTDownloadManager的download_presentation方法"""
    print("=== 测试AsyncPPTDownloadManager ===")
    
    # 创建临时目录
    temp_dir = tempfile.mkdtemp(prefix="async_fix_test_")
    print(f"测试目录: {temp_dir}")
    
    try:
        # 创建管理器实例
        manager = AsyncPPTDownloadManager(
            max_concurrent=4,
            max_retries=3,
            progress_callback=lambda slide, success, error=None: print(
                f"{'✓' if success else '✗'} slide {slide.get('index', '?')}: {'成功' if success else error}"
            )
        )
        
        # 测试数据
        test_data = {
            "title": "测试演示文稿",
            "slides": [
                {"index": 1, "cover": "https://httpbin.org/image/jpeg"},
                {"index": 2, "cover": "https://httpbin.org/image/png"}
            ]
        }
        
        # 运行异步下载
        async def run_test():
            result = await manager.download_presentation(test_data)
            return result
        
        result = asyncio.run(run_test())
        
        print(f"下载结果: {result['successful']}/{result['total']} 成功")
        
        if result['successful'] > 0:
            print("✅ 异步下载修复成功！")
            return True
        else:
            print("❌ 异步下载仍有问题")
            return False
            
    except Exception as e:
        print(f"❌ 测试失败: {str(e)}")
        return False
    finally:
        # 清理测试目录
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
            print(f"清理测试目录: {temp_dir}")

def test_classes_integration():
    """测试Classes.py集成"""
    print("\n=== 测试Classes.py集成 ===")
    
    try:
        # 模拟main_ui对象
        class MockMainUI:
            def __init__(self):
                self.config = {"sessionid": "test_session_123", "region": "0"}  # 使用数字字符串
                self.add_message_signal = MockSignal()
                self.add_course_signal = MockSignal()
                self.del_course_signal = MockSignal()
        
        class MockSignal:
            def emit(self, *args):
                print(f"Signal emit: {args}")
        
        # 模拟get_user_info函数返回值
        import Utils
        original_get_user_info = Utils.get_user_info
        Utils.get_user_info = lambda sessionid, region: (200, {"id": "test_user", "name": "测试用户"})
        
        try:
            from Classes import Lesson
            
            # 创建Lesson实例
            mock_ui = MockMainUI()
            lesson = Lesson("test_lesson", "测试课程", "test_classroom", mock_ui)
            
            # 测试async_download_manager属性
            manager = lesson.async_download_manager
            print(f"✅ async_download_manager创建成功: {type(manager).__name__}")
            
            # 测试进度回调
            lesson._async_progress_callback({"index": 1}, True)
            lesson._async_progress_callback({"index": 2}, False, "测试错误")
            
            print("✅ Classes.py集成测试通过！")
            return True
        finally:
            # 恢复原函数
            Utils.get_user_info = original_get_user_info
        
    except Exception as e:
        print(f"❌ Classes.py集成测试失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("开始异步下载修复测试...\n")
    
    test1_result = test_async_ppt_download_manager()
    test2_result = test_classes_integration()
    
    print(f"\n=== 测试结果汇总 ===")
    print(f"AsyncPPTDownloadManager: {'✅ 通过' if test1_result else '❌ 失败'}")
    print(f"Classes.py集成: {'✅ 通过' if test2_result else '❌ 失败'}")
    
    if test1_result and test2_result:
        print("\n🎉 所有测试通过！异步下载修复成功！")
    else:
        print("\n⚠️ 部分测试失败，需要进一步检查。")