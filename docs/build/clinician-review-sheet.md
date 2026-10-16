# Clinician review sheet

Every string below is used by Cases A to C and is still `draft`. Read each English line and its Arabic line, correct the Arabic (and the English if it is wrong) in the file named in each heading, then set the status to `reviewed` with your name and the date. Then run `pnpm voices` (the spoken clips are made from the voice lines) and `pnpm check-content`, which must pass before the video.

Rules that apply to all text: finding first, no hype, no exclamation marks, never the word diagnosis (except the fixed line "not a diagnosis"), no health claim except the verbatim NCI excerpts. Numbers use Western digits in both languages. Measurements keep Latin "mm".

## 1. Patient templates (`shared/content/patient-templates.en.json` and `.ar.json`)

Set `review.status` to `reviewed`, `review.reviewer` and `review.date` for each template id.

### CONDITIONAL

| Field | English | Arabic | OK |
|---|---|---|---|
| found | The report describes a finding, but the next step depends on answers we do not have. | يصف التقرير نتيجة، لكن الخطوة التالية تعتمد على إجابات لا تتوفر لدينا. | [ ] |
| reassure | NCI says: {pdq:abnormal_no_cancer} | يقول المعهد الوطني للسرطان: {pdq:abnormal_no_cancer} | [ ] |
| why | {reasons} | {reasons} | [ ] |
| todo | Please check these with your doctor: {questions} | يرجى مراجعة هذه الأمور مع طبيبك: {questions} | [ ] |
| when | Your doctor can confirm the timing once these are answered. | يمكن لطبيبك تأكيد الموعد بمجرد الإجابة على هذه الأسئلة. | [ ] |
| who | Show this page to your doctor. Ask these questions. | أرِ هذه الصفحة لطبيبك. واطرح هذه الأسئلة. | [ ] |
| voice | Some answers are still needed. Please check them with your doctor. | لا تزال هناك بعض الإجابات المطلوبة. يرجى التحقق من ذلك مع طبيبك. | [ ] |
| voice_append | Some answers are still needed. | لا تزال هناك إجابات مطلوبة. | [ ] |

### FL17-GGN1-GE6

| Field | English | Arabic | OK |
|---|---|---|---|
| found | The report describes a nodule, a small spot, in the {location}. It measures {size_mm} mm and is {type}. | يصف التقرير عقيدة، وهي بقعة صغيرة، في {location}. يبلغ حجمها {size_mm} mm و{type}. | [ ] |
| reassure | NCI says: {pdq:abnormal_no_cancer} | يقول المعهد الوطني للسرطان: {pdq:abnormal_no_cancer} | [ ] |
| why | This follows the Fleischner Society 2017 guideline for nodules found by chance on a CT scan. NCI says: {pdq:more_tests} | يتبع هذا دليل Fleischner Society 2017 للعقيدات التي يتم العثور عليها بالصدفة في الأشعة المقطعية. يقول المعهد الوطني للسرطان: {pdq:more_tests} | [ ] |
| todo | Here is what the guideline suggests. {action_list} Your doctor will decide what is right for you. | إليك ما تقترحه الإرشادات. {action_list} سيقرر طبيبلك ما يناسبك. | [ ] |
| when | The first CT is due between {window_start} and {window_end}. | موعد الأشعة المقطعية الأولى بين {window_start} و{window_end}. | [ ] |
| who | Show this page to your doctor. Ask which option is right for you. | أرِ هذه الصفحة لطبيبك. واسأله عن الخيار المناسب لك. | [ ] |
| voice | Your report shows a {type_short} nodule, {size_mm} millimetres, in the {location}. The guideline suggests a repeat CT scan in six to twelve months, to see if it is still there. Please show this page to your doctor. | يظهر في تقريرك عقيدة {type_short} بحجم {size_mm} مليمترات في {location}. تقترح الإرشادات إعادة الأشعة المقطعية، لمعرفة ما إذا كانت لا تزال موجودة. يرجى مراجعة طبيبك. | [ ] |

### FL17-S1-6TO8

| Field | English | Arabic | OK |
|---|---|---|---|
| found | The report describes a nodule, a small spot, in the {location}. It measures {size_mm} mm and is {type}. | يصف التقرير عقيدة، وهي بقعة صغيرة، في {location}. يبلغ قياسها {size_mm} mm وهي {type}. | [ ] |
| reassure | NCI says: {pdq:abnormal_no_cancer} | يقول المعهد الوطني للسرطان: {pdq:abnormal_no_cancer} | [ ] |
| why | This follows the Fleischner Society 2017 guideline for nodules found by chance on a CT scan. NCI says: {pdq:more_tests} | يتبع هذا إرشادات جمعية فليشنر 2017 للعقيدات التي يتم العثور عليها بالصدفة في الأشعة المقطعية. يقول المعهد الوطني للسرطان: {pdq:more_tests} | [ ] |
| todo | Here is what the guideline suggests. {action_list} Your doctor will decide what is right for you. | إليك ما تقترحه الإرشادات. {action_list} سيقرر طبيبلك ما يناسبك. | [ ] |
| when | The first CT is due between {window_start} and {window_end}. A second CT may follow later. | موعد الأشعة المقطعية الأولى هو بين {window_start} و{window_end}. قد يتبع ذلك فحص مقطعي ثانٍ لاحقاً. | [ ] |
| who | Show this page to your doctor. Ask which option is right for you. | أرِ هذه الصفحة لطبيبك. اسأل عن الخيار المناسب لك. | [ ] |
| voice | Your report shows a {type_short} nodule, {size_mm} millimetres, in the {location}. The guideline suggests a repeat CT scan in six to twelve months. Please show this page to your doctor. | يظهر في تقريرك عقيدة {type_short} بحجم {size_mm} مليمترات في {location}. تقترح الإرشادات إعادة الأشعة المقطعية. يرجى مراجعة طبيبك. | [ ] |

### FL17-S1-GT8

| Field | English | Arabic | OK |
|---|---|---|---|
| found | The report describes a nodule, a small spot, in the {location}. It measures {size_mm} mm and is {type}. | يصف التقرير عقيدة، وهي بقعة صغيرة، في {location}. يبلغ قياسها {size_mm} mm وهي {type}. | [ ] |
| reassure | NCI says: {pdq:abnormal_no_cancer} | يقول المعهد الوطني للسرطان: {pdq:abnormal_no_cancer} | [ ] |
| why | This follows the Fleischner Society 2017 guideline for nodules found by chance on a CT scan. NCI says: {pdq:more_tests} | يتبع هذا إرشادات جمعية فليشنر 2017 للعقيدات التي يتم العثور عليها بالصدفة في الأشعة المقطعية. يقول المعهد الوطني للسرطان: {pdq:more_tests} | [ ] |
| todo | Here is what the guideline suggests. {action_list} Your doctor will decide what is right for you. | إليك ما تقترحه الإرشادات. {action_list} سيقرر طبيبلك ما يناسبك. | [ ] |
| when | A repeat CT, if chosen, is due around {window_start}. A PET-CT or a biopsy has no fixed date in the guideline. | موعد إعادة الأشعة المقطعية، إذا تم اختيارها، هو في حدود {window_start}. لا توجد تواريخ محددة في الإرشادات للتصوير المقطعي بالإصدار البوزيتروني أو الخزعة. | [ ] |
| who | Show this page to your doctor soon. Ask which option is right for you. | أرِ هذه الصفحة لطبيبك قريباً. اسأل عن الخيار المناسب لك. | [ ] |
| voice | Your report shows a {type_short} nodule, {size_mm} millimetres, in the {location}. The guideline suggests a repeat CT in about three months, a PET-CT, or a biopsy. Please talk to your doctor soon. | يظهر في تقريرك عقيدة {type_short} بحجم {size_mm} مليمترات في {location}. تقترح الإرشادات إعادة الأشعة المقطعية أو التصوير المقطعي بالإصدار البوزيتروني أو خزعة. تحدث إلى طبيبك. | [ ] |

## 2. Controlled terms (`shared/content/anatomy-terms.json`)

Set `status` to `reviewed`.

| Key | English | Arabic | OK |
|---|---|---|---|
| action.biopsy | a biopsy | خزعة | [ ] |
| action.ct | a CT scan | الأشعة المقطعية | [ ] |
| action.pet_ct | a PET-CT | التصوير المقطعي بالإصدار البوزيتروني | [ ] |
| cond.if the area is still there | if the area is still there | إذا بقيت المنطقة موجودة | [ ] |
| location.right.lung | right lung | الرئة اليمنى | [ ] |
| location.right.upper | right upper lobe | الفص العلوي من الرئة اليمنى | [ ] |
| phrase.around | around {start} | في حدود {start} | [ ] |
| phrase.between | between {start} and {end} | بين {start} و{end} | [ ] |
| phrase.consider_one | Consider one of these: | يمكن التفكير في أحد هذه الخيارات: | [ ] |
| phrase.every_years | then every {every} years until {until} years | ثم كل {every} سنوات حتى مرور {until} سنوات | [ ] |
| phrase.optional | optional | اختياري | [ ] |
| phrase.or | or | أو | [ ] |
| phrase.risk_high | If your doctor considers your risk higher | إذا اعتبر طبيبك أن خطرك أعلى | [ ] |
| phrase.risk_low | If your doctor considers your risk low | إذا اعتبر طبيبك أن خطرك منخفض | [ ] |
| phrase.then | Then | ثم | [ ] |
| type.ground_glass | ground-glass (hazy) | زجاجية (ضبابية) | [ ] |
| type.solid | solid (dense) | صلبة (كثيفة) | [ ] |
| type_short.ground_glass | hazy | ضبابية | [ ] |
| type_short.solid | solid | صلبة | [ ] |
| ui.source | Source: NCI’s PDQ cancer information summary for patients on lung cancer screening states: | المصدر: ملخص معلومات السرطان للمرضى (PDQ) من المعهد الوطني للسرطان حول الفحص المبكر لسرطان الرئة يذكر: | [ ] |

## 3. Guideline sentences (`shared/content/engine-strings.json`)

Set `status` to `reviewed`.

| English | Arabic | OK |
|---|---|---|
| Is your immune system weakened? | هل جهازك المناعي ضعيف؟ | [ ] |

## 4. NCI PDQ excerpts (`shared/content/pdq-snippets.json`)

English must be a verbatim copy of the NCI page (check the link and date). Set `status` to `reviewed` for the source and for the Arabic.

### abnormal_no_cancer

Source: https://www.cancer.gov/types/lung/patient/lung-screening-pdq (retrieved 2026-10-16), topic: lung cancer screening

- English (verbatim): Screening test results may appear to be abnormal even though no cancer is present.
- Arabic: قد تبدو نتائج اختبار الفحص غير طبيعية حتى لو لم يكن هناك سرطان.
- [ ] English matches the NCI page   - [ ] Arabic is faithful

### more_tests

Source: https://www.cancer.gov/types/lung/patient/lung-screening-pdq (retrieved 2026-10-16), topic: lung cancer screening

- English (verbatim): If a screening test result is abnormal, you may need to have more tests done to find out if you have cancer.
- Arabic: إذا كانت نتيجة اختبار الفحص غير طبيعية، فقد تحتاج إلى إجراء المزيد من الاختبارات لمعرفة ما إذا كنت مصاباً بالسرطان.
- [ ] English matches the NCI page   - [ ] Arabic is faithful

## 5. Booking request and calendar text (`shared/content/passport.json`)

Set `status` to `reviewed`. The Arabic safety statement (`ics.statement`) is NOT drafted: write it here.

| Key | English | Arabic | OK |
|---|---|---|---|
| booking.ask_around | Could we arrange a follow-up appointment around {window_start}? | هل يمكننا ترتيب موعد متابعة في حدود {window_start}؟ | [ ] |
| booking.ask_window | Could we arrange a follow-up appointment between {window_start} and {window_end}? | هل يمكننا ترتيب موعد متابعة بين {window_start} و{window_end}؟ | [ ] |
| booking.decide | I understand this is only what a guideline suggests. Please decide what is right for me. | أدرك أن هذا مجرد اقتراح توجيهي. يرجى تحديد ما يناسب حالتي. | [ ] |
| booking.finding | My CT report says: {quote} | يقول تقرير الأشعة المقطعية الخاص بي: {quote} | [ ] |
| booking.greeting | Dear Doctor, | عزيزي الطبيب، | [ ] |
| booking.guideline | I read that the Fleischner Society 2017 guideline for nodules found by chance suggests the following. {action_text} | قرأت أن إرشادات Fleischner Society 2017 للعقد المكتشفة بالصدفة تقترح ما يلي. {action_text} | [ ] |
| booking.questions | Some answers are still needed: {questions} | ما زالت هناك حاجة إلى بعض الإجابات: {questions} | [ ] |
| booking.signoff | Prepared with NoduleBridge (decision support, not a diagnosis) | تم إعداده باستخدام NoduleBridge (دعم اتخاذ القرار وليس قراراً طبياً نهائياً) | [ ] |
| booking.source | Guideline: {citation} | الإرشادات: {citation} | [ ] |
| booking.subject | Request for a follow-up appointment | طلب موعد متابعة | [ ] |
| booking.thanks | Thank you. | شكراً لك. | [ ] |
| ics.book_summary | Book your follow-up CT | احجز متابعة الأشعة المقطعية | [ ] |
| ics.caregiver_summary | Help {name} book the follow-up CT | ساعد {name} في حجز متابعة الأشعة المقطعية | [ ] |
| ics.description | {action_text} Your doctor decides what is right for you. | {action_text} يحدد طبيبك ما هو مناسب لك. | [ ] |
| ics.window_summary | Follow-up CT window opens | تفتح نافذة متابعة الأشعة المقطعية | [ ] |

## 6. Other Arabic text to check

- Safety banner (Arabic): `web/src/components/shell/SafetyBanner.tsx` (`SAFETY_BANNER_AR` is empty on purpose; no Arabic ships until you write it). [ ] written
- Arabic button and label texts in the voice player: `web/src/components/report/PatientSummaryCard.tsx` (`UI.ar`). [ ] reviewed
- Arabic banned-word list: `shared/content/banned-words.json`. [ ] extended
- Listen to the three Arabic voice clips (`data/cases/case-*/voice.ar.mp3`). [ ] a, [ ] b, [ ] c

