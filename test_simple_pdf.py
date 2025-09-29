#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简化的PDF生成功能测试
"""

import os
import sys
import shutil
from pathlib import Path

# 添加Scripts目录到路径
sys.path.append(os.path.join(os.path.dirname(__file__), 'Scripts'))

from Scripts.PPTManager import PPTManager

def test_pdf_generation():
    """测试PDF生成功能"""
    print("开始测试PDF生成功能...")
    
    # 创建测试数据
    test_data = {
        "title": "测试PDF生成",
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
    
    try:
        # 创建PPTManager实例
        ppt_manager = PPTManager(test_data, "测试课程")
        
        # 检查目录结构
        print(f"下载路径: {ppt_manager.downloadpath}")
        print(f"课程路径: {ppt_manager.lessondownloadpath}")
        print(f"图片路径: {ppt_manager.imgpath}")
        
        # 确保目录存在
        os.makedirs(ppt_manager.imgpath, exist_ok=True)
        
        # 创建测试图片文件（模拟下载完成的图片）
        from PIL import Image, ImageDraw, ImageFont
        
        for slide in test_data["slides"]:
            image_path = os.path.join(ppt_manager.imgpath, f"{slide['index']}.jpg")
            
            # 创建测试图片
            img = Image.new('RGB', (800, 600), color=(255, 255, 255))
            draw = ImageDraw.Draw(img)
            
            # 添加文本
            try:
                font = ImageFont.truetype("C:\\Windows\\Fonts\\arial.ttf", 40)
            except:
                font = ImageFont.load_default()
            
            draw.text((50, 50), f"测试幻灯片 {slide['index']}", fill=(0, 0, 0), font=font)
            draw.text((50, 150), f"问题答案: {slide['problem']['answers']}", fill=(255, 0, 0), font=font)
            
            img.save(image_path)
            print(f"创建测试图片: {image_path}")
        
        # 生成PDF
        print("开始生成PDF...")
        pdf_name = ppt_manager.generate_ppt()
        
        if pdf_name:
            pdf_path = os.path.join(ppt_manager.lessondownloadpath, pdf_name)
            print(f"✅ PDF生成成功: {pdf_path}")
            
            if os.path.exists(pdf_path):
                print(f"   文件大小: {os.path.getsize(pdf_path)} bytes")
                return True
            else:
                print(f"❌ PDF文件不存在: {pdf_path}")
                return False
        else:
            print("❌ PDF生成失败: generate_ppt返回None")
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
    ]
    
    for test_dir in test_dirs:
        if os.path.exists(test_dir):
            try:
                shutil.rmtree(test_dir)
                print(f"已删除测试目录: {test_dir}")
            except Exception as e:
                print(f"删除测试目录失败 {test_dir}: {e}")

def main():
    """主测试函数"""
    print("=" * 50)
    print("PDF生成功能测试")
    print("=" * 50)
    
    # 执行测试
    success = test_pdf_generation()
    
    print("\n" + "=" * 50)
    if success:
        print("✅ 测试通过: PDF生成功能正常")
    else:
        print("❌ 测试失败: PDF生成功能异常")
    print("=" * 50)
    
    # 清理测试文件
    cleanup_test_files()
    
    return success

if __name__ == "__main__":
    # 运行测试
    result = main()
    sys.exit(0 if result else 1)