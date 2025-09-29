#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
测试下载路径修复
验证异步下载是否使用正确的rainclasscache路径结构
"""

import asyncio
import os
import shutil
import tempfile
from Scripts.AsyncDownloader import AsyncPPTDownloadManager

def test_path_structure():
    """测试路径结构是否正确"""
    print("=== 测试下载路径结构修复 ===")
    
    # 保存当前工作目录
    original_cwd = os.getcwd()
    
    # 创建临时测试目录
    temp_dir = tempfile.mkdtemp(prefix="path_fix_test_")
    print(f"测试目录: {temp_dir}")
    
    try:
        # 切换到测试目录
        os.chdir(temp_dir)
        
        # 创建管理器实例
        manager = AsyncPPTDownloadManager(
            max_concurrent=2,
            max_retries=1,
            progress_callback=lambda slide, success, error=None: print(
                f"{'✓' if success else '✗'} slide {slide.get('index', '?')}: {'成功' if success else error}"
            )
        )
        
        # 测试数据
        test_data = {
            "title": "第四章",
            "slides": [
                {"index": 1, "cover": "https://httpbin.org/image/jpeg"},
                {"index": 2, "cover": "https://httpbin.org/image/png"}
            ]
        }
        
        lessonname = "中国近现代史纲要"
        
        # 运行异步下载
        async def run_test():
            result = await manager.download_presentation(test_data, lessonname)
            return result
        
        result = asyncio.run(run_test())
        
        print(f"下载结果: {result}")
        
        # 检查路径结构
        expected_path = os.path.join("downloads", "rainclasscache", lessonname, "第四章")
        print(f"期望路径: {expected_path}")
        
        if os.path.exists(expected_path):
            print("✅ 路径结构正确！")
            
            # 检查文件是否存在
            files_found = []
            for i in [1, 2]:
                file_path = os.path.join(expected_path, f"{i}.jpg")
                if os.path.exists(file_path):
                    files_found.append(file_path)
                    print(f"✓ 找到文件: {file_path}")
            
            if files_found:
                print(f"✅ 成功下载 {len(files_found)} 个文件到正确路径！")
                return True
            else:
                print("❌ 路径正确但文件下载失败")
                return False
        else:
            print(f"❌ 路径结构错误，期望路径不存在: {expected_path}")
            
            # 列出实际创建的目录结构
            if os.path.exists("downloads"):
                print("实际创建的目录结构:")
                for root, dirs, files in os.walk("downloads"):
                    level = root.replace("downloads", "").count(os.sep)
                    indent = " " * 2 * level
                    print(f"{indent}{os.path.basename(root)}/")
                    subindent = " " * 2 * (level + 1)
                    for file in files:
                        print(f"{subindent}{file}")
            
            return False
            
    except Exception as e:
        print(f"❌ 测试失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        # 恢复工作目录
        os.chdir(original_cwd)
        
        # 清理测试目录
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
            print(f"清理测试目录: {temp_dir}")

if __name__ == "__main__":
    success = test_path_structure()
    if success:
        print("\n🎉 路径修复测试通过！")
    else:
        print("\n❌ 路径修复测试失败！")