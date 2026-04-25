# Web 原型规范

---

## 第一章：HTML 结构规范

### Golden Rule

**你必须严格遵守PRD文档，PRD是唯一的、最终的、最高优先级的设计依据。**

#### 1. 严禁创造、无权推断
- **严禁创造**：不得生成任何PRD中未明确提及的UI元素、文本、数据字段、功能或交互
- **无权推断**：不得基于"通用实践"或"用户可能需要"等理由添加任何内容
- **所有产出必须有据可查**：生成的HTML中的每一个部分，都必须能直接在PRD文档中找到对应的文字描述

#### 2. 视觉一致性（必须严格遵守）
- **页面风格必须与设计稿保持一致**：所有页面的视觉风格、配色、间距、字体必须与设计稿完全一致
- **核心组件必须复制设计稿**：侧边栏、顶部导航栏、卡片样式、表格样式等核心组件必须**完全复制**设计稿的 HTML 结构和 Tailwind class，不得自行设计
- **使用与设计稿相同的 tailwind.config token**：从 `design/web/selected/design.html` 提取 `tailwind.config` 块，复制到每个原型页面的 `<head>` 中（在 Tailwind CDN 之后）

#### 2.1 全局组件一致性（最高优先级）

| 组件 | 说明 | 一致性要求 |
|-----|------|----------|
| **顶部导航栏 (Header)** | 页面顶部的标题栏/导航栏 | 高度、背景色、Logo、导航链接、用户菜单必须完全一致 |
| **侧边栏 (Sidebar)** | 页面左侧的导航菜单 | 宽度、背景色、菜单项样式、图标、选中状态必须完全一致 |
| **底部栏 (Footer)** | 页面底部的版权/链接区域 | 高度、背景色、内容布局必须完全一致 |

**强制要求**：
1. 读取 `design/web/selected/design.html`，找到 `tailwind.config = { ... }` 整块，**原封不动**复制到每个原型页面 `<head>` 的 Tailwind CDN 之后
2. 禁止自行设计全局组件样式
3. **严格参照设计稿复制 nav/sidebar/header HTML 结构和 class**，不得自行设计

**是否需要 nav 的判断规则**：

| 页面情况 | header/topbar | sidebar | 依据 |
|---------|-------------|---------|------|
| `layout: sidebar-main` 页 | ✅ 需要 | ✅ 需要 | PRD `layout` 属性 |
| `layout: single-column` 页 | ✅ 需要 | ❌ 不需要 | PRD `layout` 属性 |
| `layout: auth` 页（登录/注册） | ❌ 不需要 | ❌ 不需要 | 登录页无全局导航 |
| `layout: full-width` 页 | ❌ 不需要 | ❌ 不需要 | 全屏页无导航 |

**nav 激活态**：根据页面的 `nav-active` 属性设置对应菜单项为激活态；`nav-active: —` 的页面所有菜单项均为未激活态。

**全量展示菜单项，不按权限过滤**：`@nav` 中所有菜单项包括 `roles: [admin]` 限定的管理员菜单，在各页面中必须完整展示。原型不实现权限过滤。

#### 3. 交互元素 ID 规范
- 所有有交互功能的元素必须添加可标识的 id
- ID 命名语义化：`id="btn-submit"`、`id="nav-dashboard"`、`id="table-row-1"`

---

### 样式引入规范

每个原型页面的 `<head>` 由 `scaffold_page.js` 脚本自动生成，**不得手动修改 `<head>` 内容**，包括：
- 不得新增任何 `<link>` 或 `<script src>`
- 不得修改 `tailwind.config`
- 不得引入设计稿中没有的外部资源

**可用图标库由 scaffold 注释声明**（见生成文件顶部 `<!-- scaffold-info -->`）。写 PAGE CONTENT 时只能使用注释中列出的图标库，不得使用其他图标库。

**顺序规范**（由脚本保证，仅供参考）：
1. `<meta>` 标签
2. `<link>`（字体/图标，与设计稿完全一致）
3. Tailwind CDN `<script src>`
4. `tailwind.config` 赋值块（从设计稿原样复制）
5. jQuery `<script src>`
6. `<style>` 块（与设计稿完全一致）

---

### 标准页面结构

```html
<body class="bg-background text-on-surface min-h-screen">

  <!-- 顶部导航栏（从设计稿完整复制 HTML + class） -->
  <header class="bg-surface border-b border-outline-variant sticky top-0 z-40
                 h-16 flex items-center justify-between px-6">
    <!-- ... 复制设计稿，只改激活项 ... -->
  </header>

  <div class="flex" style="height: calc(100vh - 4rem)">
    <!-- 侧边栏（如有，从设计稿完整复制） -->
    <aside class="w-60 shrink-0 bg-surface border-r border-outline-variant overflow-y-auto">
      <!-- ... -->
    </aside>

    <!-- 主内容区域 -->
    <main class="flex-1 min-w-0 overflow-y-auto bg-background p-6">
      <!-- 页面具体内容 -->
    </main>
  </div>

</body>
```

---

### 常用组件写法

```html
<!-- 主按钮 -->
<button class="bg-primary text-on-primary px-4 py-2 rounded-md text-sm font-medium
               hover:opacity-90 active:scale-[0.98] transition-all
               inline-flex items-center gap-2">保存</button>

<!-- 次按钮 -->
<button class="bg-surface text-on-surface border border-outline-variant px-4 py-2
               rounded-md text-sm font-medium hover:bg-surface-container
               active:scale-[0.98] transition-all">取消</button>

<!-- 卡片 -->
<div class="bg-surface rounded-lg shadow-card p-6">内容</div>

<!-- 输入框 -->
<input class="w-full bg-surface border border-outline-variant rounded-md px-3 py-2
              text-sm text-on-surface placeholder:text-on-surface-variant/50
              focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
              transition-colors" placeholder="请输入"/>

<!-- Badge -->
<span class="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium
             bg-success/15 text-success">进行中</span>
<span class="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium
             bg-error/15 text-error">已停止</span>

<!-- 表格 -->
<div class="bg-surface rounded-lg shadow-card overflow-hidden">
  <div class="grid grid-cols-4 px-4 py-3 bg-surface-container
              text-xs font-semibold text-on-surface-variant uppercase tracking-wide">
    <span>名称</span><span>状态</span><span>日期</span><span>操作</span>
  </div>
  <div class="divide-y divide-outline-variant/50">
    <div class="grid grid-cols-4 px-4 py-3 hover:bg-surface-container/50 transition-colors">
      <span class="text-sm font-medium text-on-surface">项目 A</span>
      <span class="inline-flex items-center px-2 py-0.5 rounded-sm text-xs
                   bg-success/15 text-success w-fit">进行中</span>
      <span class="text-sm text-on-surface-variant">2024-01-15</span>
      <button class="text-primary text-sm font-medium hover:underline w-fit">编辑</button>
    </div>
  </div>
</div>

<!-- 模态框 -->
<div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
  <div class="bg-surface rounded-xl shadow-dialog max-w-md w-full max-h-[90vh] overflow-y-auto p-6">
    内容
  </div>
</div>
```

### 颜色使用规范

```html
<div class="bg-background">页面底色</div>
<div class="bg-surface">卡片/组件背景</div>
<div class="bg-primary">主色背景</div>
<p class="text-on-surface">主要文字</p>
<p class="text-on-surface-variant">次要文字</p>
<div class="border border-outline-variant">轻量边框</div>
<div class="bg-primary/10">10% 主色背景</div>
```

### 文件命名

- 文件名 = PRD 中页面的 `url` 去掉开头的 `/`，扩展名 `.html`
- `/`（首页）→ `home.html`，`/note-detail` → `note-detail.html`
- 所有页面均放在 `prototype/web/` 目录下
- 页面间跳转：`<a href="note-detail.html">`

---

### 图片标签格式要求（必须严格遵守）

所有图片必须包含 src、alt、data-category 三个属性：

```html
<img src="https://s.coze.cn/t/3xjnXsbf0SM/" alt="年轻商务男人头像,写实风格" data-category="人物">
```

- `data-category`：人物 / 自然风景 / 动物 / 建筑城市 / 运动体育 / 交通工具 / 食物 / 服饰时尚 / 商业科技 / 游戏娱乐 / 艺术 / 其他
- `alt`：中文详细描述，10-20字

---

### 禁止事项

1. 不要生成PRD上未提到的功能要素
2. 不要添加「半透明渐变弧形装饰」
3. **禁止引用 `global.css`**
4. **禁止在页面中定义自定义组件类**（`.btn-primary { }` 等）
5. **禁止自行设计全局组件**（header/sidebar），必须严格参照设计稿复制
6. **禁止在不同页面使用不同的全局组件样式**
7. **禁止根据权限隐藏导航菜单项**，全量展示所有菜单项

---

### 页面设计检查清单

- [ ] 包含所有PRD中描述的UI元素
- [ ] 实现PRD里面提到的所有交互方式
- [ ] html中每个可交互元素都有对应的id
- [ ] `<head>` 中已内嵌与设计稿完全一致的 `tailwind.config` 块
- [ ] 颜色全部使用 token class
- [ ] Header/Sidebar 与设计稿完全一致（样式、图标有无、布局均一致）
- [ ] 根据页面 `layout` 属性正确判断是否需要 nav（auth 页和 full-width 页无 nav）
- [ ] 导航激活项与页面 `nav-active` 属性一致
- [ ] 所有菜单项全量展示，无权限过滤

---

## 第二章：交互规范

### 交互逻辑规范

#### 1. 严格依据PRD
- 只允许根据PRD文档中"页面规格"部分的"页面交互说明"表格来生成按钮、链接等可交互元素
- **禁止任何额外添加**

#### 2. jQuery统一使用
- 所有交互逻辑使用jQuery写法
- 页面脚本统一在 `$(function(){ ... })` 中初始化
- 统一使用 `$()` 与 `.on()` 进行事件绑定
- **不要使用原生 `getElementById` 或 `querySelector`**

---

### 交互HTML示例

```html
<script>
    $(function() {
        // 表单提交
        $('#login-form').on('submit', function(e) {
            e.preventDefault();
            // demo项目不判断账密，直接跳转
            window.location.href = 'home.html';
        });

        // 标签切换
        $('[role="tab"]').on('click', function() {
            $('[role="tab"]').removeClass('tab-active').addClass('tab-inactive');
            $('.tab-content').addClass('hidden');
            $(this).removeClass('tab-inactive').addClass('tab-active');
            $(`#${$(this).attr('aria-controls')}`).removeClass('hidden');
        });
    });
</script>
```

---

### 参数处理规范

#### 发送参数

```javascript
$('#detail-button').on('click', function() {
    const item_id = $(this).data('id');
    window.location.href = `detail.html?item_id=${item_id}`;
});
```

#### 接收参数：参数优先，mock 兜底（必须遵守）

二级页面（详情页、分类页等需要 URL 参数的页面）**必须**做 mock 兜底，保证直接打开 HTML 文件时也能正常展示内容。

**禁止**在参数为空时调用 `navBack()`、`window.history.back()` 或提前 `return`，这会导致页面直接打开时空白或跳走，无法 demo。

```javascript
$(function() {
    // @api-mock: get-item-detail
    const mockItemDetail = {
        success: true,
        data: { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", name: "示例标题", description: "详细描述内容" }
    };

    const params = Object.fromEntries(new URLSearchParams(window.location.search));
    // ✅ 正确：参数兜底 mock 数据的 id，保证直接打开页面也能正常展示
    const itemId = params.item_id || mockItemDetail.data.id;

    // 始终渲染，不因缺参数而跳转或返回
    renderDetail(mockItemDetail.data);

    function renderDetail(data) {
        $('#item-name').text(data.name);
        $('#item-desc').text(data.description);
    }
});
```

**❌ 禁止写法**：

```javascript
// 禁止：参数缺失时跳走，导致原型直接打开时无内容
const itemId = params.item_id;
if (!itemId) {
    navBack();   // ❌
    return;      // ❌
}
```

---

### 第三方接口处理

保留UI元素，事件处理函数中只添加一行日志：

```javascript
$('#camera-button').on('click', function() {
    console.log('需要调用第三方接口实现相机拍照功能');
});
```

---

### 侧边导航栏处理

若页面需要侧面导航栏，参照设计稿实现，布局及跳转逻辑完全一致。

---

### 登录页密码设置

- 登录页账号密码**禁止预设或硬编码**
- **禁止**出现 `username === 'xxx'` 或 `password === 'xxx'` 的判定

---

### 是否需要后端服务

在PRD的 `### 1.4 需求复杂度` 小节中会告诉你用户是否需要后端功能。

如果不需要后端：
- 要包括全部可demo的元素，如mock数据
- 如果有简单存储需求，使用localStorage
- 不需要登录和注册页面

---

## 第三章：Mock 数据与 Render 规范

### Mock 数据规范

**每个关联 API 对应一个 mock 变量**，放在 `$(function(){ ... })` 内最顶部：

- `// @api-mock: {api-id}` 注释必须紧贴变量声明上方
- 变量名语义化，如 `mockMemberList`、`mockOrderDetail`
- 字段结构必须与 PRD 中该 API 的 Response 完全对齐
- `datas: []` 接口至少准备 **3-6 条**具有差异的真实感数据
- ID 字段写标准 UUID 格式（`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`）

```javascript
$(function() {
  // @api-mock: list-members
  const mockMemberList = {
    success: true, message: "获取成功", total: 128,
    datas: [
      { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", name: "张小美", phone: "138****5678", gender: "female", balance: 3280.00, createdAt: "2024-01-15T10:30:00Z" },
      { id: "b2c3d4e5-f6a7-8901-bcde-f12345678901", name: "李晓华", phone: "139****1234", gender: "female", balance: 5600.00, createdAt: "2024-01-12T09:00:00Z" },
      { id: "c3d4e5f6-a7b8-9012-cdef-123456789012", name: "王大明", phone: "137****9999", gender: "male",   balance: 1200.00, createdAt: "2024-01-10T14:20:00Z" }
    ]
  };

  // @api-mock: get-member-detail
  const mockMemberDetail = {
    success: true, message: "获取成功",
    data: { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", name: "张小美", phone: "13812345678", gender: "female", birthday: "1992-03-15", balance: 3280.00 }
  };
});
```

---

### Render 函数规范

**所有有重复数据的展示区域必须使用 render 函数**，禁止将相同结构的 HTML 手写多次。

**适用场景（必须用 render 函数）**：
- `datas: object[]` 类型接口的内容展示
- 表格行、卡片列表、Grid 布局、下拉选项等重复元素

**命名规范**：`render{Entity}Row`（表格行）/ `render{Entity}Card`（卡片）/ `render{Entity}Option`（选项）

#### 表格行示例（对应 list- 接口）

```javascript
function renderMemberRow(item) {
  const genderText  = item.gender === 'male' ? '男' : '女';
  const balanceText = '¥' + item.balance.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const createdDate = new Date(item.createdAt).toLocaleDateString('zh-CN');
  return `
    <div class="grid grid-cols-6 gap-4 px-6 py-4 hover:bg-surface-container/50 transition-colors member-row"
         data-id="${item.id}">
      <span class="text-sm font-medium text-on-surface">${item.name}</span>
      <span class="text-sm text-on-surface-variant">${item.phone}</span>
      <span class="text-sm text-on-surface-variant">${genderText}</span>
      <span class="text-sm font-semibold text-primary">${balanceText}</span>
      <span class="text-sm text-on-surface-variant">${createdDate}</span>
      <div class="flex gap-3">
        <button class="text-primary text-sm font-medium hover:underline btn-view" data-id="${item.id}">查看</button>
        <button class="text-primary text-sm font-medium hover:underline btn-edit" data-id="${item.id}">编辑</button>
      </div>
    </div>
  `;
}

// 调用：map → join → 整块插入
$('#table-body').html(mockMemberList.datas.map(renderMemberRow).join(''));
$('#total-records').text(`共 ${mockMemberList.total} 条记录`);
```

#### 卡片 Grid 示例

```javascript
function renderOrderCard(item) {
  const statusMap = {
    pending: { label: '待处理', cls: 'bg-warning/15 text-warning' },
    done:    { label: '已完成', cls: 'bg-success/15 text-success' }
  };
  const st = statusMap[item.status] ?? { label: item.status, cls: 'bg-outline/15 text-on-surface-variant' };
  return `
    <div class="bg-surface rounded-lg shadow-card p-5 order-card" data-id="${item.id}">
      <div class="flex items-center justify-between mb-3">
        <span class="font-medium text-on-surface">${item.memberName}</span>
        <span class="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium ${st.cls}">${st.label}</span>
      </div>
      <p class="text-sm text-on-surface-variant">金额：¥${item.totalAmount.toFixed(2)}</p>
    </div>
  `;
}

$('#order-grid').html(mockOrderList.datas.map(renderOrderCard).join(''));
```

#### 搜索 / 筛选（render 函数复用）

```javascript
$('#search-input').on('keypress', function(e) {
  if (e.which !== 13) return;
  const kw = $(this).val().trim();
  const filtered = kw
    ? mockMemberList.datas.filter(d => d.name.includes(kw) || d.phone.includes(kw))
    : mockMemberList.datas;
  $('#table-body').html(filtered.map(renderMemberRow).join(''));
});
```

#### 分页（有分页时必须实现）

```javascript
let currentPage = 1;
const pageSize  = 20;

function renderPagination(total) {
  const totalPages = Math.ceil(total / pageSize);
  const pg = $('#pagination').empty();

  pg.append(`<button class="px-3 py-1.5 text-sm border border-outline-variant rounded-md
    ${currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-container'} btn-prev">上一页</button>`);

  const pages = totalPages <= 5
    ? Array.from({ length: totalPages }, (_, i) => i + 1)
    : currentPage <= 3            ? [1, 2, 3, '...', totalPages]
    : currentPage >= totalPages-2 ? [1, '...', totalPages-2, totalPages-1, totalPages]
    :                               [1, '...', currentPage, '...', totalPages];

  pages.forEach(p => {
    if (p === '...') { pg.append(`<span class="px-2 text-on-surface-variant">...</span>`); return; }
    pg.append(`<button class="px-3 py-1.5 text-sm rounded-md btn-page
      ${p === currentPage ? 'bg-primary text-on-primary' : 'border border-outline-variant hover:bg-surface-container'}"
      data-page="${p}">${p}</button>`);
  });

  pg.append(`<button class="px-3 py-1.5 text-sm border border-outline-variant rounded-md
    ${currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-container'} btn-next">下一页</button>`);

  $('#total-records').text(`共 ${total} 条记录`);
}

// 初始化
$('#table-body').html(mockMemberList.datas.map(renderMemberRow).join(''));
renderPagination(mockMemberList.total);

$(document).on('click', '.btn-prev', function() {
  if (currentPage > 1) { currentPage--; renderPagination(mockMemberList.total); }
});
$(document).on('click', '.btn-next', function() {
  if (currentPage < Math.ceil(mockMemberList.total / pageSize)) { currentPage++; renderPagination(mockMemberList.total); }
});
$(document).on('click', '.btn-page', function() {
  currentPage = +$(this).data('page');
  renderPagination(mockMemberList.total);
});
```

---

### 禁止事项

- **禁止将相同结构的 HTML 手写多次**（如复制 3 个相同的卡片）
- **禁止 `datas` 接口的内容区域直接写死 HTML**，必须通过 render 函数渲染
- **禁止丢弃 `@api-mock` 注释**，每个 mock 变量必须有对应注释
