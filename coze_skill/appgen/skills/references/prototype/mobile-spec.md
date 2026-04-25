# Mobile 原型规范

---

## 第一章：HTML 结构规范

### Golden Rule

**你必须严格遵守PRD文档，PRD是唯一的、最终的、最高优先级的设计依据。**

#### 1. 严禁创造、无权推断
- **严禁创造**：不得生成任何PRD中未明确提及的UI元素、文本、数据字段、功能或交互
- **无权推断**：不得基于"通用实践"或"用户可能需要"等理由添加任何内容
- **所有产出必须有据可查**：生成的HTML中的每一个部分，都必须能直接在PRD文档中找到对应的文字描述

**具体示例**：
- ❌ 如一个 blog 的卡片，PRD 中未出现过访问计数功能或相关页面，就不应添加访问计数的 UI 元素
- ❌ 如在个人头像区域，PRD 中未出现个人信息编辑功能或相关页面，就不应添加个人信息编辑的 UI 元素
- ❌ 如 PRD 中未提及分享功能，就不应在页面中添加分享按钮

#### 2. 视觉一致性（必须严格遵守）
- **页面风格必须与设计稿保持一致**：所有页面的视觉风格、配色、间距、字体必须与设计稿完全一致
- **核心组件必须复制设计稿**：底部 TabBar、顶部导航栏、卡片样式等核心组件必须**完全复制**设计稿的 HTML 结构和 Tailwind class，不得自行设计
- **使用与设计稿相同的 tailwind.config token**：从 `design/mobile/selected/design.html` 提取 `tailwind.config` 块，复制到每个原型页面的 `<head>` 中（在 Tailwind CDN 之后）

#### 2.1 全局组件一致性（最高优先级）

**全局组件**是指在多个页面中重复出现的通用组件，这些组件必须在所有页面中保持**完全一致**的样式和结构。

| 组件 | 说明 | 一致性要求 |
|-----|------|----------|
| **顶部导航栏 (Header)** | 页面顶部的标题栏/导航栏 | 高度、背景色、字体、图标位置必须完全一致 |
| **底部导航栏 (TabBar)** | 页面底部的标签切换栏 | 高度、背景色、图标样式、选中状态必须完全一致 |
| **页面容器** | 页面的整体布局结构 | 背景色、内边距、滚动区域必须一致 |

**强制要求**：
1. 读取 `design/mobile/selected/design.html`，找到 `tailwind.config = { ... }` 整块，**原封不动**复制到每个原型页面 `<head>` 的 Tailwind CDN 之后
2. 禁止自行设计全局组件样式
3. **严格参照设计稿复制 TabBar HTML 结构和 class**，不得自行设计

**是否需要 TabBar 的判断规则**：

| 页面情况 | TabBar | 依据 |
|---------|--------|------|
| `entry: true` 页（tabbar 一级页） | ✅ 需要 | PRD `entry` 属性 |
| `entry: false` 页（二级页、详情页等） | ❌ 不需要 | PRD `entry` 属性 |
| 登录/注册页 | ❌ 不需要 | 无导航的认证页 |

**TabBar 激活态**：根据页面的 `tab` 属性设置对应 tab 项为激活态。

**全量展示，不按权限过滤**：TabBar 中所有 tab 项必须完整展示。原型不实现权限过滤。

#### 3. 交互元素 ID 规范
- 所有有交互功能的元素必须添加可标识的 id
- ID 命名语义化：`id="btn-submit"`、`id="nav-home"`、`id="card-item-1"`

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

### 常用组件写法

```html
<!-- 主按钮（全宽） -->
<button class="w-full bg-primary text-on-primary py-3.5 rounded-xl text-base font-semibold
               hover:opacity-90 active:scale-[0.98] transition-all
               inline-flex items-center justify-center gap-2">
  确认
</button>

<!-- 卡片 -->
<div class="bg-surface rounded-xl shadow-card mx-4 p-4">内容</div>

<!-- 输入框 -->
<input class="w-full bg-surface-container border border-outline-variant rounded-xl
              px-4 py-3 text-base text-on-surface placeholder:text-on-surface-variant/50
              focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
              transition-colors"/>

<!-- Badge -->
<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold
             bg-primary/15 text-primary">新</span>

<!-- 模态框（底部弹出） -->
<div class="fixed inset-0 bg-black/50 z-50 flex items-end">
  <div class="bg-surface rounded-t-2xl w-full max-h-[80vh] overflow-y-auto p-6
              pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
    内容
  </div>
</div>
```

### 颜色使用规范

颜色通过 tailwind.config 注册的 token class 使用：

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
- 所有页面均放在 `prototype/mobile/` 目录下

---

### 图片标签格式要求（必须严格遵守）

所有图片必须包含 src、alt、data-category 三个属性：

```html
<img src="https://s.coze.cn/t/3xjnXsbf0SM/" alt="年轻商务男人头像,写实风格" data-category="人物">
```

- `src`：完整 URL（http/https）
- `data-category`：人物 / 自然风景 / 动物 / 建筑城市 / 运动体育 / 交通工具 / 食物 / 服饰时尚 / 商业科技 / 游戏娱乐 / 艺术 / 其他
- `alt`：中文详细描述，10-20字

---

### 禁止事项

1. 不要生成PRD上未提到的功能要素
2. 不要添加「半透明渐变弧形装饰」
3. 不要生成手机顶部的状态条
4. 不要生成模拟的键盘
5. 如无需要，不要弹出新窗口
6. **禁止生成模拟 iPhone 的黑色边框/外壳**
7. **禁止引用 `global.css`**
8. **禁止在页面中定义自定义组件类**
9. **禁止自行设计 TabBar**，必须严格参照设计稿复制
10. **禁止在不同页面使用不同的全局组件样式**
11. **禁止根据权限隐藏 tab 项**，全量展示所有 tab

---

### 页面设计检查清单

- [ ] 包含所有PRD中描述的UI元素
- [ ] 实现PRD里面提到的所有交互方式
- [ ] html中每个可交互元素都有对应的id
- [ ] 所有传递参数的跳转必须在目标页面正确解析和处理参数
- [ ] `<head>` 中已内嵌与设计稿完全一致的 `tailwind.config` 块
- [ ] 颜色全部使用 token class
- [ ] TabBar 与设计稿完全一致（样式、图标有无、布局均一致）
- [ ] 根据 `entry` 属性正确判断是否需要 TabBar（`entry: false` 页无 TabBar）
- [ ] TabBar 激活项与页面 `tab` 属性一致
- [ ] 所有 tab 项全量展示，无权限过滤

---

## 第二章：交互规范

### 交互逻辑规范

#### 1. 严格依据PRD
- 只允许根据PRD文档中"页面规格"部分的"页面交互说明"表格来生成按钮、链接等可交互元素
- **禁止任何额外添加**：严禁添加任何PRD中未明确定义的交互功能或按钮

#### 2. jQuery统一使用
- 所有交互逻辑使用jQuery写法
- 页面脚本统一在 `$(function(){ ... })` 中初始化事件绑定与逻辑
- 统一使用jQuery选择器 `$()` 与 `.on()` 进行事件绑定
- **不要使用原生 `getElementById` 或 `querySelector`**

---

### 列表选择/编辑点击区分离（重要）

卡片拆成两个独立热区：主操作区（约85%）+ 编辑按钮区（约15%，宽度≥44px）：

```html
<div class="item-card" data-id="addr-1">
    <div class="card-main"><!-- 选择/进入详情 --></div>
    <button class="card-edit-btn" aria-label="编辑"></button>
</div>
<script>
$(function(){
    $('.card-main').on('click', function(){
        const id = $(this).closest('.item-card').data('id');
        selectItem(id);
    });
    $('.card-edit-btn').on('click', function(e){
        e.stopPropagation(); // 必须阻止冒泡
        const id = $(this).closest('.item-card').data('id');
        editItem(id);
    });
});
</script>
```

---

### 第三方接口处理

对于相机、媒体、设备、支付等第三方API，保留UI元素，事件处理函数中只添加一行日志：

```html
<button id="camera-button" class="px-6 py-2 bg-primary text-on-primary rounded-lg">拍照</button>
<script>
    $(function() {
        $('#camera-button').on('click', function() {
            console.log('需要调用第三方接口实现相机拍照功能');
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
    navPush(`detail.html?item_id=${item_id}`);
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

### 登录页密码设置

- 由于此项目为demo项目，登录页的账号密码**禁止预设或硬编码**
- 用户可使用任意符合格式的账号密码登录
- **禁止**出现 `username === 'xxx'` 或 `password === 'xxx'` 的判定

---

### 是否需要后端服务

在PRD的 `### 1.4 需求复杂度` 小节中会告诉你用户是否需要后端功能。

如果用户不需要后端功能，你生成的原型HTML页面就是最终交付的产品：
- 要包括全部可demo的元素，如需要的mock数据
- 如果有简单存储需求，使用localStorage
- 不需要后端的情况下一定不需要登录和注册，不要生成相关页面

---

## 第三章：导航规范

### 四种核心导航动作

| 动作 | 场景 | 函数 |
|------|------|------|
| **PUSH（层级深入）** | 列表→详情，需要返回 | `navPush(route)` |
| **REPLACE（流程切换）** | 步骤1→步骤2，登录→注册 | `navReplace(route)` |
| **RESET（归位）** | 支付成功→回首页，退出登录 | `navReset(route)` |
| **BACK（返回）** | 左上角返回按钮，取消 | `navBack()` |

### 导航辅助函数（每个页面必须定义）

```javascript
function navPush(route) {
    console.log(`[原型演示] PUSH 到: ${route}`);
    window.location.href = route;
}

function navReplace(route) {
    console.log(`[原型演示] REPLACE 为: ${route}`);
    window.location.replace(route);
}

function navReset(route) {
    console.log(`[原型演示] RESET 到: ${route}`);
    window.location.href = route;
}

function navBack() {
    console.log(`[原型演示] BACK 返回上一页`);
    if(window.history.length > 1) window.history.back();
}
```

> **必须**：每个页面的 `<script>` 中都要定义这四个函数。

---

### 一级页 vs 二级页规则

- **一级页**（`entry: true`，TabBar 直达）：有底部 TabBar，**无**返回按钮
- **二级页**（`entry: false`）：有返回按钮，**无**底部 TabBar
- PRD 中 `entry` 字段决定，不得擅自添加或移除 TabBar / 返回按钮

### TabBar 导航规则

- TabBar 标签间切换使用 `navReset`，不用 `navPush`
- 当前激活标签高亮显示
- TabBar HTML 结构和样式必须完全复制设计稿

```html
<!-- 示意结构，实际以设计稿为准 -->
<nav id="bottom-nav"
     class="fixed bottom-0 left-0 right-0 z-40 bg-surface
            border-t border-outline-variant flex justify-around items-center
            h-14 pb-[env(safe-area-inset-bottom)]">
    <a href="home.html" id="nav-home" class="flex flex-col items-center gap-0.5 px-5 py-1.5 text-primary">
        <span class="material-symbols-outlined text-2xl"
              style="font-variation-settings:'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24">home</span>
        <span class="text-[10px] font-bold">首页</span>
    </a>
    <a href="profile.html" id="nav-profile" class="flex flex-col items-center gap-0.5 px-5 py-1.5 text-on-surface-variant">
        <span class="material-symbols-outlined text-2xl">person</span>
        <span class="text-[10px] font-bold">我的</span>
    </a>
</nav>

<script>
    $(function() {
        $('#nav-home').on('click', function(e) {
            e.preventDefault();
            navReset('home.html');
        });
        $('#nav-profile').on('click', function(e) {
            e.preventDefault();
            navReset('profile.html');
        });
    });
</script>
```

### TabBar 设计原则

1. 所有Tab项统一尺寸、间距和视觉权重
2. 保持左右对称，特殊按钮只能放中间
3. 标签数量建议奇数（3或5个）
4. 避免在导航型TabBar中混入操作型按钮

---

## 第四章：Mock 数据与 Render 规范

### Mock 数据规范

**每个关联 API 对应一个 mock 变量**，放在 `$(function(){ ... })` 内最顶部：

- `// @api-mock: {api-id}` 注释必须紧贴变量声明上方
- 变量名语义化，如 `mockPostList`、`mockUserProfile`
- 字段结构必须与 PRD 中该 API 的 Response 完全对齐
- `datas: []` 接口至少准备 **3-5 条**具有差异的真实感数据
- ID 字段写标准 UUID 格式

```javascript
$(function() {
  // @api-mock: list-posts
  const mockPostList = {
    success: true, message: "获取成功", total: 36,
    datas: [
      { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", content: "今日份 OOTD", images: ["https://s.coze.cn/t/abc/"], userId: "u1", username: "小初",  likeCount: 128, createdAt: "2024-03-15T10:30:00Z" },
      { id: "b2c3d4e5-f6a7-8901-bcde-f12345678901", content: "美味午餐分享", images: ["https://s.coze.cn/t/def/"], userId: "u2", username: "美食家", likeCount: 56,  createdAt: "2024-03-14T12:00:00Z" },
      { id: "c3d4e5f6-a7b8-9012-cdef-123456789012", content: "周末去爬山了", images: [],                         userId: "u3", username: "户外控", likeCount: 89,  createdAt: "2024-03-13T08:20:00Z" }
    ]
  };

  // @api-mock: get-me
  const mockCurrentUser = {
    success: true, message: "获取成功",
    data: { id: "u1", username: "小初", avatar: "https://i.pravatar.cc/100?u=1", followCount: 128, fanCount: 256 }
  };
});
```

---

### Render 函数规范

**所有有重复数据的展示区域必须使用 render 函数**，禁止将相同结构的 HTML 手写多次。

**适用场景（必须用 render 函数）**：
- `datas: object[]` 类型接口的内容展示
- 卡片列表、Feed 流、选择列表、网格等重复元素

**命名规范**：`render{Entity}Card`（卡片）/ `render{Entity}Item`（列表项）/ `render{Entity}Option`（选项）

#### 卡片列表示例（对应 list- / search- 接口）

```javascript
function renderPostCard(item) {
  const imageHtml = item.images.length
    ? `<img src="${item.images[0]}" alt="${item.content},竖版图片" data-category="其他"
            class="w-full h-40 object-cover rounded-lg mt-2"/>`
    : '';
  return `
    <div class="bg-surface rounded-xl shadow-card mx-4 mb-3 p-4 post-card" data-id="${item.id}">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
          <span class="text-xs font-bold text-primary">${item.username[0]}</span>
        </div>
        <span class="text-sm font-medium text-on-surface">${item.username}</span>
      </div>
      <p class="text-sm text-on-surface">${item.content}</p>
      ${imageHtml}
      <div class="flex items-center gap-1 mt-3 text-on-surface-variant">
        <i class="fas fa-heart text-sm btn-like" data-id="${item.id}"></i>
        <span class="text-xs">${item.likeCount}</span>
      </div>
    </div>
  `;
}

// 调用：map → join → 整块插入
$('#post-list').html(mockPostList.datas.map(renderPostCard).join(''));
```

#### 选择列表示例（如服务项目、地址等）

```javascript
function renderServiceItem(item) {
  return `
    <div class="flex items-center px-4 py-3 bg-surface border-b border-outline-variant/50
                active:bg-surface-container transition-colors service-item" data-id="${item.id}">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-on-surface">${item.name}</p>
        <p class="text-xs text-on-surface-variant mt-0.5">¥${item.price} · ${item.duration}分钟</p>
      </div>
      <i class="fas fa-chevron-right text-on-surface-variant/50 text-sm"></i>
    </div>
  `;
}

$('#service-list').html(mockServiceList.datas.map(renderServiceItem).join(''));
```

#### 下拉刷新 / 加载更多（需要时）

```javascript
// 追加更多数据（模拟分页加载）
$('#btn-load-more').on('click', function() {
  // 追加新数据（mock 场景：复用现有数据模拟）
  $('#post-list').append(mockPostList.datas.map(renderPostCard).join(''));
  // 模拟无更多数据
  $(this).text('没有更多了').prop('disabled', true);
});
```

---

### 禁止事项

- **禁止将相同结构的 HTML 手写多次**（如复制 3 个相同的卡片）
- **禁止 `datas` 接口的内容区域直接写死 HTML**，必须通过 render 函数渲染
- **禁止丢弃 `@api-mock` 注释**，每个 mock 变量必须有对应注释
