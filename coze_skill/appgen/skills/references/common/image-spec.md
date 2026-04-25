# 图片规范

## 图片引用方式

图片应使用 URL 引用（例如，来自 Unsplash、Pexels 的链接，或指向项目内图片文件的相对/绝对路径）。

**禁止在 HTML 中使用 Base64 编码嵌入图片。**

---

## 图片标签格式要求（必须严格遵守）

所有图片必须使用如下HTML标签格式，便于后续用正则提取和自动处理：

### 必须包含的属性
- **src**: 图片的完整 URL（http/https）
- **alt**: 图片的描述
- **data-category**: 图片所属的大类

### 属性顺序
属性顺序可任意，但三个属性都不能省略。

---

## 标签示例

```html
<img src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4" alt="山" data-category="自然">
```

```html
<img src="https://s.coze.cn/t/3xjnXsbf0SM/" alt="年轻商务男人头像,写实风格" data-category="人物">
```

---

## data-category 可选值

- 人物
- 自然风景
- 动物
- 建筑城市
- 运动体育
- 交通工具
- 食物
- 服饰时尚
- 商业科技
- 游戏娱乐
- 艺术
- 其他

---

## alt 描述规范

### 中文描述
- 长度建议2-5字（简洁版）或10-20字（详细版）
- 不要包含修饰词
- alt 也是图片的搜索词，后续可用作图片检索关键字

### 英文描述
- 建议1-2个单词
- 不要包含修饰词

### 人物类图片
需描述年龄性别等基本特征，例如：
- "年轻商务男人头像,写实风格"
- "中年女性微笑照片"

---

## 正则匹配示例（Python）

```python
from html.parser import HTMLParser


class ImgParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []

    def handle_starttag(self, tag, attrs):
        if tag != "img":
            return
        attr_map = dict(attrs)
        src = attr_map.get("src")
        alt = attr_map.get("alt")
        data_category = attr_map.get("data-category")
        if src and alt and data_category:
            self.images.append((src, alt, data_category))


parser = ImgParser()
parser.feed(html_string)
images = parser.images
```
