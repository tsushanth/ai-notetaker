# ScribeAI — Arabic (ar-SA) App Store Metadata

Drafted 2026-06-11. Push via ASC API on the next appStoreVersion bump
(can't be applied to a READY_FOR_SALE version). The portfolio cadence is
~2 days between releases, so this can ride the next code ship.

## Name (limit 30)

```
ScribeAI: ملاحظات ذكية
```
(22 chars)

## Subtitle (limit 30)

```
ملخصات الفيديو والمستندات
```
(25 chars)

## Keywords (limit 100, comma-separated, no spaces between keywords matters for some markets)

```
ملاحظات,تلخيص,فيديو,صوت,نسخ,محاضرات,بطاقات,ذكاء اصطناعي,دراسة,تحويل النص
```
(72 chars)

## Description (limit 4000)

```
حوّل أي فيديو أو ملف صوتي أو مستند إلى ملاحظات منظمة، وملخصات دقيقة، وبطاقات تعليمية في ثوانٍ. ScribeAI هو مساعدك الذكي للدراسة والعمل والإنتاجية.

🎯 لماذا ScribeAI؟

سواء كنت طالباً تحضّر للامتحانات، أو محترفاً تتابع الاجتماعات، أو باحثاً يستوعب كميات كبيرة من المحتوى — ScribeAI يحوّل ساعات من المراجعة إلى دقائق من الاستيعاب الفعّال.

✨ المزايا الرئيسية:

📹 تحويل الفيديو إلى نص
- استورد فيديوهات من اليوتيوب أو من جهازك
- احصل على نص كامل مع طوابع زمنية
- ترجمة فورية لأكثر من 50 لغة

🎙️ نسخ الصوت الذكي
- سجّل محاضراتك واجتماعاتك مباشرة
- ادعم ملفات MP3 وWAV وM4A
- دقة عالية مع تمييز المتحدثين

📝 ملخصات بالذكاء الاصطناعي
- ملخصات قصيرة أو مفصّلة حسب احتياجك
- النقاط الأساسية مستخرجة تلقائياً
- اقتباسات مهمة مع المراجع

🃏 بطاقات تعليمية تلقائية
- يولّد ScribeAI بطاقات سؤال وجواب من أي محتوى
- مثالية للحفظ والمراجعة قبل الامتحانات
- صدّرها لتطبيقات Anki أو Quizlet

💬 اسأل أي شيء عن المحتوى
- محادثة ذكية مع ملاحظاتك
- احصل على إجابات فورية مع المصادر
- مثل وجود معلم خاص لك

📊 مستندات PDF وWord
- لخّص الكتب الإلكترونية والأبحاث
- استخرج النقاط الأساسية في ثوانٍ
- ابحث داخل مستنداتك بالذكاء الاصطناعي

🌍 يدعم 50+ لغة
- العربية، الإنجليزية، الفرنسية، الإسبانية والمزيد
- ترجمة فورية ودقيقة
- واجهة عربية كاملة

🔒 خصوصيتك أولاً
- ملاحظاتك محفوظة على جهازك
- لا نشارك بياناتك مع أي طرف ثالث
- مزامنة آمنة مع iCloud اختيارية

💎 خطط مرنة
ابدأ مجاناً ثم ترقّ إلى Premium لتحويلات غير محدودة، تصدير متقدم، وميزات الذكاء الاصطناعي الكاملة.

📚 مثالي لـ:
- الطلاب الجامعيين والثانويين
- الباحثين والأكاديميين
- مدراء المشاريع والمحترفين
- المعلمين والمدربين
- منشئي المحتوى

حمّل ScribeAI اليوم وحوّل طريقتك في التعلم والعمل.
```

## What's New (per-release)

```
الإصدار الجديد يأتي بدعم محسّن للغة العربية، تحويلات أسرع، وواجهة أكثر سلاسة. شكراً لكم!
```

## Why this matters

64% of ScribeAI's installs come from MENA (EG/SA/AE/KW). Until this push,
ar-SA was a placeholder shell that inherited the English description +
English keywords. Adding proper Arabic listing should materially lift
conversion in those markets — they're already finding and installing the
app in English; localized listing removes friction.

## Push procedure (next ScribeAI release)

```python
# Replace VID with the new appStoreVersion ID, IID with the new appInfo ID
PATCH /v1/appInfoLocalizations/<ar-SA id>
  attributes: { name, subtitle }
PATCH /v1/appStoreVersionLocalizations/<ar-SA id>
  attributes: { description, keywords }
```

Both will succeed when the parent appInfo/appStoreVersion is in
`PREPARE_FOR_SUBMISSION` state (auto-created at next build upload).

## Open items (not yet drafted)

- Arabic **screenshots** (12 needed, matching en-US count). Defer to next
  ScribeAI build cycle — either via the aso-optimizer pipeline (Recraft +
  text overlay translation) or by running the app with Arabic UI on a real
  device.
- Hebrew (`he`) localization — same RTL infrastructure, smaller market.
- 24 other placeholder locales (cs, hr, ms, ru, pt-PT, fi, el, no, hu,
  vi, sk, ro, da, th, sv, nl-NL, pl, zh-Hant, es-MX, tr, id, ca, uk) —
  all using English fallback. Lower priority than MENA.
