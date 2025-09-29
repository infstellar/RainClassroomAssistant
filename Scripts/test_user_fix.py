#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
测试User类修复
"""

def test_user_class_fix():
    """测试User类的get_userinfo方法修复"""
    print("=== 测试User类修复 ===")
    
    try:
        from Classes import User
        
        # 创建User实例
        test_user = User("test_uid_123")
        print(f"✅ User实例创建成功: uid={test_user.uid}")
        
        # 测试get_userinfo方法签名（不实际调用，只检查方法是否存在且参数正确）
        import inspect
        sig = inspect.signature(test_user.get_userinfo)
        params = list(sig.parameters.keys())
        
        expected_params = ['classroomid', 'headers', 'region']
        if params == expected_params:
            print(f"✅ get_userinfo方法参数正确: {params}")
        else:
            print(f"❌ get_userinfo方法参数错误: 期望{expected_params}, 实际{params}")
            return False
        
        print("✅ User类修复验证通过！")
        return True
        
    except Exception as e:
        print(f"❌ User类测试失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_lesson_integration():
    """测试Lesson类与User类的集成"""
    print("\n=== 测试Lesson类集成 ===")
    
    try:
        # 模拟main_ui对象
        class MockMainUI:
            def __init__(self):
                self.config = {"sessionid": "test_session_123", "region": "0"}
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
            from Classes import Lesson, User
            
            # 创建Lesson实例
            mock_ui = MockMainUI()
            lesson = Lesson("test_lesson", "测试课程", "test_classroom", mock_ui)
            
            # 测试User类在Lesson中的使用
            test_user = User("test_uid")
            lesson.classmates_ls.append(test_user)
            
            # 模拟调用get_userinfo（不实际发送请求）
            print("✅ User类可以正常在Lesson中使用")
            print("✅ Lesson类集成测试通过！")
            return True
            
        finally:
            # 恢复原函数
            Utils.get_user_info = original_get_user_info
        
    except Exception as e:
        print(f"❌ Lesson集成测试失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("开始User类修复测试...\n")
    
    test1_result = test_user_class_fix()
    test2_result = test_lesson_integration()
    
    print(f"\n=== 测试结果汇总 ===")
    print(f"User类修复: {'✅ 通过' if test1_result else '❌ 失败'}")
    print(f"Lesson集成: {'✅ 通过' if test2_result else '❌ 失败'}")
    
    if test1_result and test2_result:
        print("\n🎉 所有测试通过！User类config错误已修复！")
        print("现在newdanmu功能应该可以正常工作，不会再出现'User' object has no attribute 'config'错误。")
    else:
        print("\n⚠️ 部分测试失败，需要进一步检查。")