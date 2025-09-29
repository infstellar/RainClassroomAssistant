#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
测试异步下载重复检测功能
"""

import asyncio
import tempfile
import os
import shutil
from PIL import Image
from AsyncDownloader import AsyncImageDownloader, AsyncPPTDownloadManager

def create_test_image(path: str, size: tuple = (100, 100)):
    """创建测试图片"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img = Image.new('RGB', size, color='red')
    img.save(path, 'JPEG')

def test_duplicate_detection():
    """测试重复下载检测功能"""
    print("=== 测试重复下载检测功能 ===")
    
    # 创建临时目录
    temp_dir = tempfile.mkdtemp(prefix="duplicate_test_")
    img_path = os.path.join(temp_dir, "images")
    os.makedirs(img_path, exist_ok=True)
    
    try:
        # 创建一些已存在的测试图片
        existing_files = [
            os.path.join(img_path, "1.jpg"),
            os.path.join(img_path, "2.jpg")
        ]
        
        for file_path in existing_files:
            create_test_image(file_path)
        
        print(f"创建了 {len(existing_files)} 个已存在的测试图片")
        
        # 创建下载器实例（启用跳过已存在文件）
        downloader = AsyncImageDownloader(
            max_concurrent=4,
            skip_existing=True,
            progress_callback=lambda slide, success, error=None: print(
                f"{'✓' if success else '✗'} slide {slide.get('index', '?')}: {'成功' if success else error}"
            )
        )
        
        # 测试数据（包含已存在和不存在的文件）
        test_slides = [
            {"index": 1, "cover": "https://httpbin.org/image/jpeg"},  # 已存在
            {"index": 2, "cover": "https://httpbin.org/image/png"},   # 已存在
            {"index": 3, "cover": "https://httpbin.org/image/jpeg"},  # 不存在
            {"index": 4, "cover": "https://httpbin.org/image/png"}    # 不存在
        ]
        
        # 运行异步下载测试
        async def run_test():
            result = await downloader.download_slides(test_slides, img_path)
            return result
        
        result = asyncio.run(run_test())
        
        print(f"\n下载结果:")
        print(f"总计: {result['total']}")
        print(f"成功: {result['successful']}")
        print(f"失败: {result['failed']}")
        print(f"跳过: {result.get('skipped', 0)}")
        
        # 验证结果
        expected_skipped = 2  # 应该跳过2个已存在的文件
        actual_skipped = result.get('skipped', 0)
        
        if actual_skipped == expected_skipped:
            print("✅ 重复下载检测功能正常！")
            return True
        else:
            print(f"❌ 重复下载检测有问题，期望跳过 {expected_skipped} 个，实际跳过 {actual_skipped} 个")
            return False
            
    except Exception as e:
        print(f"❌ 测试失败: {str(e)}")
        return False
    finally:
        # 清理测试目录
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
            print(f"清理测试目录: {temp_dir}")

def test_ppt_manager_duplicate_detection():
    """测试PPT管理器的重复检测功能"""
    print("\n=== 测试PPT管理器重复检测功能 ===")
    
    # 创建临时目录
    temp_dir = tempfile.mkdtemp(prefix="ppt_duplicate_test_")
    
    try:
        # 创建管理器实例
        manager = AsyncPPTDownloadManager(
            max_concurrent=4,
            max_retries=3,
            skip_existing=True,
            progress_callback=lambda slide, success, error=None: print(
                f"{'✓' if success else '✗'} slide {slide.get('index', '?')}: {'成功' if success else error}"
            )
        )
        
        # 测试数据
        test_data = {
            "title": "测试重复检测演示文稿",
            "slides": [
                {"index": 1, "cover": "https://httpbin.org/image/jpeg"},
                {"index": 2, "cover": "https://httpbin.org/image/png"}
            ]
        }
        
        # 第一次下载
        async def run_first_download():
            result = await manager.download_presentation(test_data)
            return result
        
        print("执行第一次下载...")
        first_result = asyncio.run(run_first_download())
        print(f"第一次下载结果: {first_result['successful']}/{first_result['total']} 成功")
        
        # 第二次下载（应该跳过所有文件）
        async def run_second_download():
            result = await manager.download_presentation(test_data)
            return result
        
        print("\n执行第二次下载（测试重复检测）...")
        second_result = asyncio.run(run_second_download())
        print(f"第二次下载结果: {second_result['successful']}/{second_result['total']} 成功")
        print(f"跳过文件数: {second_result.get('skipped', 0)}")
        
        # 验证第二次下载应该跳过所有文件
        if second_result.get('skipped', 0) == len(test_data['slides']):
            print("✅ PPT管理器重复检测功能正常！")
            return True
        else:
            print("❌ PPT管理器重复检测有问题")
            return False
            
    except Exception as e:
        print(f"❌ 测试失败: {str(e)}")
        return False
    finally:
        # 清理测试目录
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
            print(f"清理测试目录: {temp_dir}")

def test_disable_duplicate_detection():
    """测试禁用重复检测功能"""
    print("\n=== 测试禁用重复检测功能 ===")
    
    # 创建临时目录
    temp_dir = tempfile.mkdtemp(prefix="no_duplicate_test_")
    img_path = os.path.join(temp_dir, "images")
    os.makedirs(img_path, exist_ok=True)
    
    try:
        # 创建一个已存在的测试图片
        existing_file = os.path.join(img_path, "1.jpg")
        create_test_image(existing_file)
        
        # 创建下载器实例（禁用跳过已存在文件）
        downloader = AsyncImageDownloader(
            max_concurrent=4,
            skip_existing=False,  # 禁用重复检测
            progress_callback=lambda slide, success, error=None: print(
                f"{'✓' if success else '✗'} slide {slide.get('index', '?')}: {'成功' if success else error}"
            )
        )
        
        # 测试数据
        test_slides = [
            {"index": 1, "cover": "https://httpbin.org/image/jpeg"}  # 已存在但应该重新下载
        ]
        
        # 运行异步下载测试
        async def run_test():
            result = await downloader.download_slides(test_slides, img_path)
            return result
        
        result = asyncio.run(run_test())
        
        print(f"下载结果: {result['successful']}/{result['total']} 成功")
        print(f"跳过: {result.get('skipped', 0)}")
        
        # 验证结果（应该没有跳过任何文件）
        if result.get('skipped', 0) == 0:
            print("✅ 禁用重复检测功能正常！")
            return True
        else:
            print("❌ 禁用重复检测功能有问题")
            return False
            
    except Exception as e:
        print(f"❌ 测试失败: {str(e)}")
        return False
    finally:
        # 清理测试目录
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
            print(f"清理测试目录: {temp_dir}")

if __name__ == "__main__":
    print("开始重复下载检测功能测试...\n")
    
    test1_result = test_duplicate_detection()
    test2_result = test_ppt_manager_duplicate_detection()
    test3_result = test_disable_duplicate_detection()
    
    print(f"\n=== 测试结果汇总 ===")
    print(f"基础重复检测: {'✅ 通过' if test1_result else '❌ 失败'}")
    print(f"PPT管理器重复检测: {'✅ 通过' if test2_result else '❌ 失败'}")
    print(f"禁用重复检测: {'✅ 通过' if test3_result else '❌ 失败'}")
    
    if test1_result and test2_result and test3_result:
        print("\n🎉 所有重复检测测试通过！功能实现成功！")
    else:
        print("\n⚠️ 部分测试失败，需要进一步检查。")