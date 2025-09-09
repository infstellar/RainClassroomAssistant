#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI答案分析器测试脚本
用于测试AI分析功能是否正常工作
"""

import os
import sys
import json
from Scripts.AIAnswerAnalyzer import AIAnswerAnalyzer

def test_ai_analyzer():
    """测试AI分析器功能"""
    
    # 测试配置
    test_config = {
        'enable_ai_analysis': True,
        'openai_api_key': 'your-test-api-key',  # 请替换为实际的API密钥
        'openai_api_base': 'https://api.openai.com/v1',
        'openai_model': 'gpt-4-vision-preview'
    }
    
    print("=== AI答案分析器测试 ===")
    
    # 初始化分析器
    try:
        analyzer = AIAnswerAnalyzer(test_config)
        print("✓ AI分析器初始化成功")
    except Exception as e:
        print(f"✗ AI分析器初始化失败: {e}")
        return False
    
    # 测试缓存目录创建
    if os.path.exists(analyzer.cache_dir):
        print("✓ 缓存目录创建成功")
    else:
        print("✗ 缓存目录创建失败")
        return False
    
    # 测试缓存文件路径生成
    cache_path = analyzer.get_cache_file_path("测试课程", "测试PPT")
    expected_path = os.path.join(analyzer.cache_dir, "测试课程_测试PPT.json")
    if cache_path == expected_path:
        print("✓ 缓存文件路径生成正确")
    else:
        print(f"✗ 缓存文件路径生成错误: {cache_path} != {expected_path}")
        return False
    
    # 测试安全文件名生成
    safe_name = analyzer._safe_filename("测试/文件:名称")
    if "测试_文件_名称" == safe_name:
        print("✓ 安全文件名生成正确")
    else:
        print(f"✗ 安全文件名生成错误: {safe_name}")
        return False
    
    # 测试缓存保存和加载
    test_answers = {
        "1": [1, 2],
        "2": [3],
        "3": [1, 2, 3, 4]
    }
    
    try:
        analyzer.save_cached_answers("测试课程", "测试PPT", test_answers)
        loaded_answers = analyzer.load_cached_answers("测试课程", "测试PPT")
        
        if loaded_answers == test_answers:
            print("✓ 缓存保存和加载功能正常")
        else:
            print(f"✗ 缓存数据不匹配: {loaded_answers} != {test_answers}")
            return False
    except Exception as e:
        print(f"✗ 缓存保存/加载失败: {e}")
        return False
    
    # 测试问题答案应用
    test_problems = [
        {"index": 1, "answers": [1]},
        {"index": 2, "answers": [2]},
        {"index": 3, "answers": [3]}
    ]
    
    try:
        updated_problems = analyzer.get_cached_answers_for_problems(
            "测试课程", "测试PPT", test_problems
        )
        
        # 检查答案是否被正确应用
        if (updated_problems[0]['answers'] == [1, 2] and 
            updated_problems[1]['answers'] == [3] and 
            updated_problems[2]['answers'] == [1, 2, 3, 4]):
            print("✓ 缓存答案应用功能正常")
        else:
            print("✗ 缓存答案应用失败")
            print(f"实际结果: {[p['answers'] for p in updated_problems]}")
            return False
    except Exception as e:
        print(f"✗ 答案应用失败: {e}")
        return False
    
    # 清理测试文件
    try:
        test_cache_file = analyzer.get_cache_file_path("测试课程", "测试PPT")
        if os.path.exists(test_cache_file):
            os.remove(test_cache_file)
        print("✓ 测试文件清理完成")
    except Exception as e:
        print(f"⚠ 测试文件清理失败: {e}")
    
    print("\n=== 所有测试通过! ===")
    return True

def test_config_loading():
    """测试配置加载"""
    print("\n=== 配置加载测试 ===")
    
    # 检查示例配置文件
    config_file = "ai_config_example.json"
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                config = json.load(f)
            print("✓ 示例配置文件加载成功")
            print(f"配置项: {list(config.keys())}")
        except Exception as e:
            print(f"✗ 示例配置文件加载失败: {e}")
            return False
    else:
        print("✗ 示例配置文件不存在")
        return False
    
    return True

if __name__ == "__main__":
    print("开始测试AI答案分析器...\n")
    
    # 添加Scripts目录到路径
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'Scripts'))
    
    success = True
    
    # 运行基础功能测试
    if not test_ai_analyzer():
        success = False
    
    # 运行配置测试
    if not test_config_loading():
        success = False
    
    if success:
        print("\n🎉 所有测试通过！AI分析功能已就绪。")
        print("\n下一步:")
        print("1. 在配置文件中设置你的OpenAI API密钥")
        print("2. 将 enable_ai_analysis 设置为 true")
        print("3. 开始使用AI分析功能")
    else:
        print("\n❌ 部分测试失败，请检查错误信息并修复问题。")
    
    input("\n按回车键退出...")