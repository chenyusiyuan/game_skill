# 多主体应用规范

## 什么是多主体应用

能切换"当前操作对象"的应用，就是多主体应用。主体可以是人、物、组织、空间等任何需要独立管理的实体。

### 判断标准（最简）
- 是否存在「当前 X」的概念？
- 是否可以在多个 X 之间切换？
- 首页内容是否随 X 改变？

任意一个是 YES → 多主体应用

### 常见多主体场景示例

| 场景类型 | 主体示例 | 典型应用 |
|---------|---------|---------|
| 人员管理 | 当前孩子、当前学生、当前员工、当前患者 | 育儿应用、教育应用、HR系统、医疗应用 |
| 宠物/动物 | 当前宠物、当前牲畜 | 宠物管理、养殖管理 |
| 商业实体 | 当前门店、当前仓库、当前分公司、当前品牌 | 连锁店管理、仓储系统、企业管理 |
| 项目/空间 | 当前项目、当前工作空间、当前团队、当前群组 | 项目管理、协作工具、社群应用 |
| 资产/设备 | 当前车辆、当前房产、当前设备 | 车队管理、物业管理、设备运维 |
| 账号/角色 | 当前账号、当前角色、当前身份 | 多账号应用、角色切换系统 |

---

## 设计要求

### 切换入口限制
- **仅允许**在主页和设置页提供切换/管理主体的功能
- 切换用本页面模态窗口实现
- **严禁**在其他任何业务页面（如详情页、编辑页、记录页、日历页、列表页等）提供切换主体的入口
- 否则会造成数据上下文混乱

### 首次无主体处理
- 先进入主体选择/创建页或弹窗
- 引导完成最少必要信息
- 避免直接触发接口空参

### 全局主体选择器
- 在主要页面显式展示当前主体（头像/名称）
- 提供切换入口
- 切换后停留原页并重拉数据
- 无数据时给空态+主要操作按钮

---

## PRD页面详情说明

### 主页（P-HOME）和设置页（P-SETTING）
```
- 本页面支持切换当前主体（模态窗口实现），切换后更新 localStorage 并刷新页面数据。
- 主体为空时引导用户添加主体。
```

### 非主页和设置页（如日历页、列表页、详情页等）
```
- 本页面**不提供**主体切换入口，仅展示当前主体的数据。
- 当前主体为空时，页面显示空状态。
```

---

## 参数获取规范

根据页面类型不同，获取主体ID的方式也不同：

| 页面类型 | 获取主体ID的方式 | 跳转方式 | 示例页面 |
|---------|-----------------|---------|---------|
| **TabBar 页面（一级页面）** | 从 localStorage 读取 | `navReset`（无参数） | P-HOME、P-MENU（作为Tab时）、P-MY |
| **新开窗口（二级页面）** | 从 URL 参数获取 | `navPush`（带参数） | P-STORE_DETAIL?store_id=xxx |

### 核心逻辑
- TabBar 页面显示的是"当前选中主体"的数据，所以从 localStorage 读取
- 新开窗口是"查看某个具体对象"的详情，可能不是当前主体，所以从 URL 读取

---

## localStorage 存储示例

```javascript
/**
 * 获取当前主体ID
 * @returns {string|null} - 当前主体ID，未设置时返回 null
 */
function getCurrentEntityId() {
    const key = `current_entity_id`;
    return localStorage.getItem(key);
}

/**
 * 设置当前主体ID
 * @param {string} entityId - 主体ID
 */
function setCurrentEntityId(entityId) {
    const key = `current_entity_id`;
    localStorage.setItem(key, entityId);
}
```

---

## 页面初始化示例

### TabBar 页面初始化
```javascript
// P-MENU.html - TabBar 页面，从 localStorage 获取当前门店
$(function() {
    const currentStoreId = getCurrentEntityId();
    
    if (!currentStoreId) {
        showEmptyState('请先选择门店');
        return;
    }
    
    loadMenuData(currentStoreId);
});
```

### 新开窗口初始化
```javascript
// P-STORE_DETAIL.html - 二级页面，从 URL 获取门店ID
$(function() {
    const params = getUrlParams();
    const storeId = params.store_id;
    
    if (!storeId) {
        showError('缺少门店参数');
        return;
    }
    
    loadStoreDetail(storeId);
    
    // "去点单"按钮 - 切换当前门店并跳转到 TabBar 页面
    $('#btn-go-order').on('click', function() {
        setCurrentEntityId(storeId);
        navReset('P-MENU.html');
    });
});
```

### 首页切换主体的模态窗口
```javascript
// P-HOME.html - 首页，支持切换当前主体
$(function() {
    const currentStoreId = getCurrentEntityId();
    
    if (!currentStoreId) {
        showStoreSelectModal();
    } else {
        loadHomeData(currentStoreId);
    }
    
    $('#btn-switch-store').on('click', function() {
        showStoreSelectModal();
    });
    
    $('#store-select-modal').on('click', '.store-item', function() {
        const newStoreId = $(this).data('store-id');
        setCurrentEntityId(newStoreId);
        closeStoreSelectModal();
        loadHomeData(newStoreId);
    });
});
```

---

## 交互热区分离

多功能卡片需分离选择与编辑热区，事件分别实现(两个单独函数)。

切换主体应该使用模态窗口实现(出现在底部)，不要弹出新窗口。
