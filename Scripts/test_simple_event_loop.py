#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简化的事件循环修复测试
专注于验证AsyncDownloader的Semaphore延迟创建修复
"""

import asyncio
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

# 添加项目路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from Scripts.AsyncDownloader import AsyncImageDownloader, AsyncPPTDownloadManager


def test_core_fix():
    """测试核心修复：Semaphore延迟创建"""
    print("=== 测试核心修复：Semaphore延迟创建 ===")
    
    try:
        # 1. 创建下载器（不在事件循环中）
        downloader = AsyncImageDownloader(max_concurrent=2)
        print(f"✓ 下载器创建成功，_semaphore初始值: {downloader._semaphore}")
        
        # 2. 在事件循环中获取Semaphore
        async def test_semaphore():
            semaphore = downloader.semaphore
            print(f"✓ 在事件循环中成功获取Semaphore: {type(semaphore)}")
            return True
        
        # 运行测试
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(test_semaphore())
        loop.close()
        
        print("✓ Semaphore延迟创建测试通过")
        return True
        
    except Exception as e:
        print(f"❌ Semaphore延迟创建测试失败: {e}")
        return False


def test_multiple_threads():
    """测试多线程环境下的事件循环兼容性"""
    print("\n=== 测试多线程事件循环兼容性 ===")
    
    downloader = AsyncImageDownloader(max_concurrent=2)
    results = []
    
    def thread_test(thread_id):
        try:
            # 每个线程创建自己的事件循环
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            async def test_in_loop():
                # 获取Semaphore并测试锁定
                semaphore = downloader.semaphore
                async with semaphore:
                    print(f"✓ 线程 {thread_id}: 成功获取Semaphore锁")
                    await asyncio.sleep(0.1)  # 模拟工作
                return True
            
            result = loop.run_until_complete(test_in_loop())
            loop.close()
            print(f"✓ 线程 {thread_id}: 事件循环测试完成")
            return result
            
        except Exception as e:
            print(f"❌ 线程 {thread_id}: 测试失败: {e}")
            return False
    
    # 启动多个线程
    threads = []
    for i in range(3):
        thread = threading.Thread(target=lambda i=i: results.append(thread_test(i)))
        threads.append(thread)
        thread.start()
    
    # 等待所有线程完成
    for thread in threads:
        thread.join()
    
    success_count = sum(results)
    print(f"✓ 多事件循环测试: {success_count}/{len(results)} 个线程成功")
    
    return success_count == len(results)


def test_download_manager():
    """测试AsyncPPTDownloadManager"""
    print("\n=== 测试AsyncPPTDownloadManager ===")
    
    try:
        # 创建下载管理器
        manager = AsyncPPTDownloadManager(max_concurrent=2)
        
        # 模拟下载数据
        test_data = {
            "course": {"name": "测试课程"},
            "presentation": {"title": "测试演示文稿"},
            "slides": [
                {"index": 1, "cover": "https://httpbin.org/image/jpeg"}
            ]
        }
        
        # 在新事件循环中测试下载
        def test_download():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            try:
                result = loop.run_until_complete(manager.download_presentation(test_data))
                return result
            finally:
                loop.close()
        
        # 使用线程池执行（模拟Classes.py中的使用方式）
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(test_download)
            result = future.result(timeout=30)
        
        print(f"✓ 下载管理器测试结果: {result}")
        print("✓ AsyncPPTDownloadManager事件循环测试通过")
        return True
        
    except Exception as e:
        print(f"❌ AsyncPPTDownloadManager测试失败: {e}")
        return False


def main():
    """主测试函数"""
    print("开始简化事件循环修复测试...\n")
    
    # 运行所有测试
    test1_result = test_core_fix()
    test2_result = test_multiple_threads()
    test3_result = test_download_manager()
    
    # 汇总结果
    print(f"\n=== 测试结果汇总 ===")
    print(f"Semaphore延迟创建: {'✅ 通过' if test1_result else '❌ 失败'}")
    print(f"多线程事件循环兼容性: {'✅ 通过' if test2_result else '❌ 失败'}")
    print(f"AsyncPPTDownloadManager: {'✅ 通过' if test3_result else '❌ 失败'}")
    
    all_passed = all([test1_result, test2_result, test3_result])
    
    if all_passed:
        print("\n🎉 所有核心测试通过！事件循环修复成功！")
        print("✓ 修复了'<asyncio.locks.Semaphore object> is bound to a different event loop'错误")
        print("✓ Semaphore现在会在正确的事件循环中延迟创建")
        print("✓ 支持多线程环境下的不同事件循环")
        print("✓ AsyncPPTDownloadManager可以在新事件循环中正常工作")
    else:
        print("\n⚠️ 部分测试失败，需要进一步检查。")
    
    return all_passed


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)