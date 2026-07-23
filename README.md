# كلام له لازمه — الإعداد الكامل

## المتطلبات
- Node.js 18+
- حساب Vercel + GitHub

---

## خطوة ١: إنشاء Notion Integration

1. اذهب إلى https://www.notion.so/my-integrations
2. اضغط **New integration**
3. اسمه: `kalam-site`، اختر workspace الخاص بيك
4. انسخ الـ **Internal Integration Token** (بيبدأ بـ `secret_`)

## خطوة ٢: ربط الـ Integration بالـ Database

1. افتح database **مقالات كلام له لازمه** في Notion
2. اضغط على **...** (أعلى اليمين) → **Connections** → أضف `kalam-site`

## خطوة ٣: معرفة الـ Database ID

1. افتح الـ database في المتصفح
2. الـ URL بيكون كده:
   `https://www.notion.so/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...`
3. الجزء بين `/` و `?` ده هو الـ **Database ID**

## خطوة ٤: رفع المشروع على GitHub

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/kalam-site.git
git push -u origin main
```

## خطوة ٥: نشر على Vercel

1. اذهب إلى https://vercel.com/new
2. استورد الـ repository من GitHub
3. في **Environment Variables** أضف:
   - `NOTION_TOKEN` = الـ token من خطوة ١
   - `NOTION_DATABASE_ID` = الـ ID من خطوة ٣
4. اضغط **Deploy** ✅

## خطوة ٦: إعداد Auto-Deploy عند إضافة مقال جديد

1. في Vercel → **Settings** → **Git** → انسخ الـ **Deploy Hook URL**
2. في Notion → الـ Database → **...** → **Automations**
3. اعمل Automation:
   - **Trigger:** When page is added
   - **Action:** Send webhook → الصق الـ Deploy Hook URL

> بعد كده، كل ما تضيف مقال جديد في الـ database وتشغل الـ deploy، الموقع بيتحدث لوحده!

---

## إضافة مقال جديد

1. افتح الـ database **مقالات كلام له لازمه** في Notion
2. اضغط **New** واملأ:
   - **العنوان**: عنوان المقال
   - **Slug**: اسم الـ URL (إنجليزي بدون مسافات، مثل: `my-article`)
   - **التصنيف**: اختر أو أضف تصنيف
   - **المقتطف**: جملة أو جملتين تلخص المقال
   - **الأيقونة**: إيموجي 🎯
   - **منشور**: ✅ (ضع علامة عشان يظهر في الموقع)
3. اكتب المحتوى كاملًا داخل الصفحة
4. في Vercel → **Deployments** → اضغط **Redeploy** (أو انتظر الـ webhook)

---

## تنسيقات خاصة في المحتوى

| ماذا تكتب | كيف يظهر |
|---|---|
| `﴿نص الآية﴾` | نص ذهبي بخط Amiri |
| `«نص الحديث»` | نص أخضر زمردي |
| `<closing>...</closing>` | بلوك خاتمة مميز |
