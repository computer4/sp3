/* STAR PRODUCTION — chatbot FAQ list + matcher (single source of truth).
   A plain script on purpose: it loads in the browser from ANY page (a hosted site, or index.html opened from a folder)
   and in the server via require(). Edit the FAQs and the matcher here. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.STAR_FAQ = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
'use strict';
// The chatbot's FAQ answers. Answers are shown to visitors exactly as written here.
// `k` = extra search words (synonyms / alternative phrasings) that help match a visitor's question.
// Answer text supports: [label](mailto:…|https://…) links, `code`, and "* " bullet lines.

const MAIL = '[starprod.in@gmail.com](mailto:starprod.in@gmail.com)';

const FAQS = [
  // ── General ───────────────────────────────────────────────
  {
    id: 1, category: 'General',
    q: 'What services does STAR PRODUCTION provide?',
    k: 'offer provide services create songs',
    alias: ['what do you do', 'what is star production', 'who are you', 'what do you offer', 'tell me about star production', 'about you', 'what is this'],
    a: 'STAR PRODUCTION provides complete original song creation services, working with artists to turn their ideas into professionally produced, release-ready songs.',
  },
  {
    id: 2, category: 'General',
    q: 'Do you work with independent and upcoming artists?',
    k: 'eligible requirement requirements beginner new artist who can apply released song spotify youtube',
    a: 'Yes. We work with artists, but you should have at least one officially released song available on major platforms such as Spotify or YouTube. This helps us ensure that artists using our services have a basic understanding of the music-production process.',
  },
  {
    id: 3, category: 'General',
    q: 'What genres of music do you work with?',
    k: 'genre style hip hop rap pop rock lofi classical punjabi bollywood type',
    a: 'We work across different genres. You can choose the genre and style you are comfortable with, and our team will work according to your artistic direction.',
  },
  {
    id: 4, category: 'General',
    q: 'Do you work with artists remotely?',
    k: 'online remote location city studio visit in person from anywhere',
    a: 'Yes. STAR PRODUCTION works remotely, allowing artists to collaborate with our team from anywhere.',
  },
  {
    id: 5, category: 'General',
    q: 'Can I discuss my song idea with you before purchasing a plan?',
    k: 'talk contact consult discuss before buying call speak',
    a: `Yes. You can contact us at ${MAIL} with your requirements. We aim to respond within 3 working days.`,
  },

  // ── Music Production ──────────────────────────────────────
  {
    id: 6, category: 'Music Production',
    q: 'I only have a song idea or melody. Can you build the complete song?',
    k: 'only idea melody lyrics hum build full song from scratch',
    a: 'Yes, if you are an artist who meets our basic requirements. STAR PRODUCTION is designed for artists who already have basic music knowledge and at least one released song.',
  },
  {
    id: 7, category: 'Music Production',
    q: 'Can I send reference songs for the sound or vibe I want?',
    k: 'reference references inspiration like this song vibe sound mood khyal',
    a: 'Yes. You can provide reference songs to communicate the overall direction, mood, or style you are looking for. Our experienced producers, including khyal, can use these references to understand your vision.',
  },
  {
    id: 8, category: 'Music Production',
    q: 'Can you create an original production based on my reference without copying it?',
    k: 'copy copying plagiarism copyright original similar rip',
    a: 'Yes. References can be used to understand your desired sound and direction, while our team creates an original production for your project.',
  },
  {
    id: 9, category: 'Music Production',
    q: 'Can I bring my own beat or instrumental and get it developed further?',
    k: 'own beat instrumental existing project develop improve upgrade my beat',
    a: 'Yes. Our team can work with your existing project. Simply create an account, choose the appropriate plan, and submit your project and requirements through the provided system.',
  },
  {
    id: 10, category: 'Music Production',
    q: 'Do I get the final instrumental or stems after production?',
    k: 'stems stem instrumental files karaoke minus one separate tracks multitrack',
    a: 'This depends on your project, plan, and the specific working conditions. If it is possible for your project, we can provide the relevant files.',
  },

  // ── Vocal Mixing, Mixing & Mastering ──────────────────────
  {
    id: 11, category: 'Vocal Mixing, Mixing & Mastering',
    q: 'Can you mix and master a song that was recorded somewhere else?',
    k: 'only mixing only mastering recorded elsewhere another studio already recorded mix master my song',
    a: 'Yes. For detailed information about mixing and mastering requirements, please visit khyal\'s website or contact us.',
  },
  {
    id: 12, category: 'Vocal Mixing, Mixing & Mastering',
    q: 'What files should I send for mixing?',
    k: 'mixing files format wav stems tracks prepare export send',
    a: 'Please follow the file-preparation requirements provided for your project. For detailed mixing-file requirements, you can refer to khyal\'s website or contact us.',
  },
  {
    id: 13, category: 'Vocal Mixing, Mixing & Mastering',
    q: 'Do you provide vocal editing and vocal processing?',
    k: 'vocal vocals tuning autotune pitch correction editing processing',
    a: 'Yes. Vocal editing, processing, mixing, and mastering are available according to the selected plan.',
  },
  {
    id: 14, category: 'Vocal Mixing, Mixing & Mastering',
    q: 'What is the difference between mixing and mastering?',
    k: 'mixing mastering meaning explain what is mix master',
    a: 'Mixing is the process of balancing and processing the individual elements of a song—such as vocals, drums, instruments, effects, and other tracks—so they work together properly.\n\nMastering is the final stage of audio production. It prepares the completed mix for consistent playback, appropriate loudness, and distribution across platforms.',
  },
  {
    id: 15, category: 'Vocal Mixing, Mixing & Mastering',
    q: 'Will the final master be ready for Spotify, YouTube and other platforms?',
    k: 'release ready distribution upload streaming platforms apple music jiosaavn',
    a: 'Yes. Our plans provide a release-ready final output, subject to the requirements and conditions of the selected plan.',
  },
  {
    id: 16, category: 'Vocal Mixing, Mixing & Mastering',
    q: 'Can I request changes after receiving the first version?',
    k: 'changes edits modify fix correction revise revision first version draft',
    a: `Revisions depend on your selected plan. If you need a change that is not covered by your plan, you can contact us at ${MAIL} and we will let you know whether it can be accommodated.`,
  },
  {
    id: 17, category: 'Vocal Mixing, Mixing & Mastering',
    q: 'What counts as a revision?',
    k: 'revision revisions how many number limit scope counts',
    a: 'The number and scope of revisions depend on the plan you purchase. Please check the specific plan details before ordering.',
  },
  {
    id: 18, category: 'Vocal Mixing, Mixing & Mastering',
    q: 'What happens if I need more revisions than my plan includes?',
    k: 'extra additional more revisions exceed over limit run out',
    a: `Additional revisions are not automatically included. You can contact us at ${MAIL}. If we are able to provide additional revisions, an additional charge may apply.`,
  },

  // ── Plans & Pricing ───────────────────────────────────────
  {
    id: 19, category: 'Plans & Pricing',
    q: 'What is included in each plan?',
    k: 'plan plans included includes features benefits inclusions package bundle',
    a: 'Every plan has its own services, features, revision limits, and final deliverables. Please check the individual plan details on the website before purchasing.',
  },
  {
    id: 20, category: 'Plans & Pricing',
    q: 'What is the difference between Foundation, Creator, Studio and Signature?',
    k: 'foundation creator studio signature compare comparison difference plans which plan best',
    a: 'Each plan provides a different level of production and release support. The exact differences, included services, revisions, and deliverables are listed under each plan on the website.',
  },
  {
    id: 21, category: 'Plans & Pricing',
    q: 'Are the prices per song?',
    k: 'price prices of plans plan cost how much rate fee per song pricing charge',
    a: 'Yes. All STAR PRODUCTION plans are priced per song.',
  },
  {
    id: 22, category: 'Plans & Pricing',
    q: 'Are there any additional charges apart from the plan price?',
    k: 'hidden charges extra cost additional fees gst final price',
    a: 'The displayed plan price is the final price for the services included in that plan. Additional charges may only apply where you request services or work that are outside the selected plan and are agreed upon separately.',
  },
  {
    id: 23, category: 'Plans & Pricing',
    q: 'Can I upgrade my plan later?',
    k: 'upgrade change plan switch higher plan move',
    a: `Yes. You can upgrade your plan before production starts by paying the remaining amount required for the upgraded plan. Contact us at ${MAIL} to request an upgrade.`,
  },
  {
    id: 24, category: 'Plans & Pricing',
    q: 'Can I purchase only one specific service instead of a complete plan?',
    k: 'single service individual separate only one just mixing just artwork custom a la carte buy',
    a: `Our website currently offers the listed service packages rather than individual services separately. However, you can contact us at ${MAIL} if you have a specific requirement.`,
  },

  // ── Ordering & Payment ────────────────────────────────────
  {
    id: 25, category: 'Ordering & Payment',
    q: 'How do I place an order?',
    k: 'order buy purchase book get started start how to checkout',
    a: `Select the plan that suits your requirements and complete the payment using the available payment method. If you experience any issue while placing your order, contact us at ${MAIL}.`,
  },
  {
    id: 26, category: 'Ordering & Payment',
    q: 'What payment methods do you accept?',
    k: 'payment methods upi qr gpay google pay phonepe paytm card netbanking credit debit paypal',
    a: 'We commonly accept UPI and QR-based payments. Available payment options will be shown during the ordering process.',
  },
  {
    id: 27, category: 'Ordering & Payment',
    q: 'When does work on my project begin after payment?',
    k: 'when start begin work after payment production begin timeline',
    a: 'Once your payment has been confirmed, you will receive access to your dashboard. You can then provide your project details, explain your requirements and specify your role in the project. Production will begin after the required information has been received.',
  },
  {
    id: 28, category: 'Ordering & Payment',
    q: 'What happens if my payment fails or is not confirmed?',
    k: 'payment failed failure not confirmed deducted pending stuck error money debited',
    a: 'Production cannot begin until the payment has been successfully confirmed from our side.',
  },
  {
    id: 29, category: 'Ordering & Payment',
    q: 'Can I get a refund after placing an order?',
    k: 'refund refunds money back cancel cancellation return reimbursement',
    a: 'If you have a problem with your order, you can contact us regarding a refund. Refund eligibility depends on whether production has started and is subject to our Terms & Conditions.',
  },

  // ── Project Process ───────────────────────────────────────
  {
    id: 30, category: 'Project Process',
    q: 'What happens after I purchase a plan?',
    k: 'after purchase next steps what then process bought paid',
    a: 'After your payment is confirmed, your account dashboard will be updated. You can provide your project details and requirements through the dashboard, after which our team can begin working on your project.',
  },
  {
    id: 31, category: 'Project Process',
    q: 'How do I send my vocals, instrumental and other files?',
    k: 'send upload share files vocals zip folder wav naming how to send transfer',
    a: 'Please put your project files into a ZIP folder, preferably in WAV format where applicable. Clearly name each file according to its purpose—for example:\n\n`Lead Vocal.wav`\n`Backing Vocal.wav`\n`Instrumental.wav`\n\nProper file organization helps us work on your project efficiently.',
  },
  {
    id: 32, category: 'Project Process',
    q: 'How will I communicate my requirements and feedback?',
    k: 'communicate communication feedback requirements contact reach talk message support',
    a: `You can contact us at ${MAIL} for project-related communication. We aim to respond within 3 working days.`,
  },
  {
    id: 33, category: 'Project Process',
    q: 'How will I receive the finished project?',
    k: 'receive delivery deliver finished final files download get',
    a: 'The completed project will be delivered to you through email or the delivery method specified for your project.',
  },
  {
    id: 34, category: 'Project Process',
    q: 'How long does a project usually take?',
    k: 'how long time duration days weeks turnaround timeline deadline',
    a: 'We aim to complete projects as soon as possible. With good communication and cooperation from the artist, a project may be completed in approximately one week, although the actual timeline can vary depending on the project\'s requirements.',
  },
  {
    id: 35, category: 'Project Process',
    q: 'Can I request urgent or fast delivery?',
    k: 'urgent fast quick rush express emergency asap earlier deadline hurry',
    a: 'You can ask us about urgent delivery. If our team is available to accommodate the request, we will provide the project as soon as reasonably possible.',
  },

  // ── Ownership & Credits ───────────────────────────────────
  {
    id: 36, category: 'Ownership & Credits',
    q: 'Who owns the final song after the project is completed?',
    k: 'own owner ownership rights belong who owns copyright master tag',
    a: 'The final song remains yours according to the applicable conditions of your selected plan and our Terms & Conditions. STAR PRODUCTION may retain an associated production credit/tag where applicable.',
  },
  {
    id: 37, category: 'Ownership & Credits',
    q: 'Will STAR PRODUCTION take ownership of my song?',
    k: 'take ownership steal rights keep my song copyright claim',
    a: 'No. STAR PRODUCTION does not simply take ownership of your song. Specific rights, credits, usage conditions, and other details are governed by our Terms & Conditions.',
  },
  {
    id: 38, category: 'Ownership & Credits',
    q: 'How are producer, songwriter and composer credits handled?',
    k: 'credit credits producer songwriter composer written by name credited',
    a: `Credits depend on the actual contribution of the people involved in the project. For specific credit arrangements, contact us at ${MAIL} before production begins.`,
  },
  {
    id: 39, category: 'Ownership & Credits',
    q: 'Can I commercially release the final song on Spotify, YouTube and other platforms?',
    k: 'commercial release commercially monetize publish distribute upload earn money royalties',
    a: 'Yes, subject to the conditions of your selected plan and our Terms & Conditions.',
  },
  {
    id: 40, category: 'Ownership & Credits',
    q: 'Can STAR PRODUCTION use my finished song in its portfolio or social media?',
    k: 'portfolio social media promote promotion showcase use my song instagram share publicly',
    a: 'Depending on your selected plan and the applicable conditions, STAR PRODUCTION may use completed work for portfolio, promotional, or social-media purposes. Please refer to our Terms & Conditions for complete details.',
  },

  // ── Account & Dashboard ───────────────────────────────────
  {
    id: 41, category: 'Account & Dashboard',
    q: 'Why do I need to create an account?',
    k: 'account signup sign up register registration why required login',
    a: 'Your account allows us to maintain your project and plan history. It also allows us to provide account-specific information and potentially offer exclusive offers based on your previous plans.',
  },
  {
    id: 42, category: 'Account & Dashboard',
    q: 'What can I see in my dashboard?',
    k: 'dashboard contains shows see features',
    a: 'Your dashboard can include:\n\n* Previous plans\n* Current plan\n* Current project status\n* Plan upgrade options\n* Project-related information\n* Other account and order information',
  },
  {
    id: 43, category: 'Account & Dashboard',
    q: 'Can I track my order and project status from my dashboard?',
    k: 'track tracking order status project progress follow',
    alias: ['where is my order', 'where is my project', 'order status', 'project status', 'status of my order', 'status of my project'],
    a: 'Yes. Your dashboard is designed to let you keep track of your current project and relevant order information.',
  },
  {
    id: 44, category: 'Account & Dashboard',
    q: 'What happens if I forget my password?',
    k: 'forgot forget password reset recover lost login cant login',
    a: 'You can use the Forgot Password option on the website. If you need additional assistance, you can contact us.',
  },
  {
    id: 45, category: 'Account & Dashboard',
    q: 'Can I update my account information?',
    k: 'update change edit account information email mobile phone name details profile',
    a: 'Account details may be fixed after registration. If you need to make a change, contact STAR PRODUCTION and we will let you know whether the requested change can be made.',
  },

  // ── Project Requirements ──────────────────────────────────
  {
    id: 46, category: 'Project Requirements',
    q: 'What happens if the files I send are poor quality?',
    k: 'poor bad low quality files audio noisy mp3 recording quality',
    a: 'We will request suitable-quality files because the quality of the source material directly affects the final result. If the provided files cannot produce an acceptable result, we may ask you to provide better-quality material.',
  },
  {
    id: 47, category: 'Project Requirements',
    q: 'Can you fix badly recorded vocals?',
    k: 'badly recorded vocals fix noise noisy out of tune off key phone recording bad recording',
    a: 'We can edit and process vocals to improve their quality. However, if the original recording has serious technical or quality problems, we may contact you and request a better recording.',
  },
  {
    id: 48, category: 'Project Requirements',
    q: 'Can you work with unfinished songs?',
    k: 'unfinished incomplete half finished demo rough draft work in progress',
    a: 'Yes. We can work with unfinished projects, provided that the material and requirements are suitable for the selected service. Any copyright-related requirements must also be followed according to our Terms & Conditions.',
  },
  {
    id: 49, category: 'Project Requirements',
    q: 'What if I don\'t know exactly what I want my song to sound like?',
    k: 'not sure dont know unsure vision confused idea sound like help decide',
    a: 'You can describe your idea, mood, references, or vision in your own words. You can also contact us if you would like to discuss your project with a producer before starting.',
  },
  {
    id: 50, category: 'Project Requirements',
    q: 'Can I request specific plugins, instruments or sounds?',
    k: 'plugins plugin instruments instrument sounds sample vst guitar piano specific tools',
    a: 'Yes, you can request specific tools, instruments, sounds, or production approaches. We will accommodate the request where technically and practically possible.',
  },
  {
    id: 51, category: 'Project Requirements',
    q: 'Can multiple artists collaborate on one project?',
    k: 'multiple artists collaborate collaboration duo group band feature featuring together two artists',
    a: 'Yes. Our plans are priced per song, so multiple artists can be involved in a project where applicable. Specific collaboration and credit arrangements should be discussed before production begins.',
  },

  // ── Why STAR PRODUCTION? ──────────────────────────────────
  {
    id: 52, category: 'Why STAR PRODUCTION?',
    q: 'Why should an artist choose STAR PRODUCTION?',
    k: 'why choose you best reason trust good affordable',
    a: 'STAR PRODUCTION aims to provide professional music production and artist services at an affordable price. We work with people involved in different parts of music—including artists, singers, writers, producers, and other creators.',
  },
  {
    id: 53, category: 'Why STAR PRODUCTION?',
    q: 'What makes your production process different?',
    k: 'different unique special better compared others competitors process quality',
    a: 'Our focus is on delivering quality production and professional processing while keeping our services accessible and affordable for developing artists.',
  },
  {
    id: 54, category: 'Why STAR PRODUCTION?',
    q: 'Can STAR PRODUCTION help with the release and promotion of my song?',
    k: 'release promotion promote marketing distribution launch publicity help release',
    a: 'Yes. Release and promotional support is available depending on the plan you select.',
  },
  {
    id: 55, category: 'Why STAR PRODUCTION?',
    q: 'Do you provide cover artwork, reels, posters and music videos?',
    k: 'cover artwork art poster reels shorts music video visualizer thumbnail design visuals',
    a: 'Yes. These services are available according to the features included in your selected plan.',
  },
  {
    id: 56, category: 'Why STAR PRODUCTION?',
    q: 'Can you help build an artist\'s overall brand?',
    k: 'brand branding identity image content growth artist growth management',
    a: 'Yes. STAR PRODUCTION aims to support artists beyond individual songs by helping with production, content, branding, promotional material, and other aspects of an artist\'s growth, depending on the selected services.',
  },
];

/** Question ids shown as quick-start chips when the chat opens. */
const POPULAR_FAQ_IDS = [21, 26, 34, 29, 2, 19];

const GREETING_REPLY = 'Hi! I\'m the STAR PRODUCTION assistant. Ask me anything about our services, plans, payments or the project process — or tap a question below.';
const THANKS_REPLY = 'You\'re welcome! Anything else I can help you with?';

// Dependency-free FAQ matcher: TF-IDF style keyword overlap between the visitor's message and the FAQs.

const STOPWORDS = new Set(
  ('a about am an and any are as at be been but by can could did do does for from get got had has have how i if in into is it its ' +
    'just me my of on or our please so some than that the their them then there these they this to us was we were what when where which who ' +
    'whom why will with would you your yours hi hello hey tell want need like also know let').split(' '),
);

// Different words people use for the same thing → one canonical token.
const SYNONYMS = {
  cost: 'price', costs: 'price', pricing: 'price', prices: 'price', rate: 'price', rates: 'price', fee: 'price', fees: 'price', charge: 'price', charges: 'price', amount: 'price',
  pay: 'payment', paying: 'payment', paid: 'payment', payments: 'payment',
  refunded: 'refund', refunds: 'refund', 'money-back': 'refund',
  songs: 'song', track: 'song', tracks: 'song', music: 'song',
  vocals: 'vocal', voice: 'vocal', singing: 'vocal',
  revisions: 'revision', revise: 'revision', revised: 'revision',
  artwork: 'cover', poster: 'cover', posters: 'cover', thumbnail: 'cover', thumbnails: 'cover',
  reel: 'reels', shorts: 'reels',
  video: 'video', videos: 'video', visualizer: 'video',
  mail: 'email', gmail: 'email',
  buy: 'order', purchase: 'order', purchasing: 'order', bought: 'order', book: 'order',
  signup: 'account', register: 'account', registration: 'account', login: 'account', profile: 'account',
  password: 'password', passwords: 'password', forgot: 'password', forget: 'password',
  fast: 'urgent', quick: 'urgent', quickly: 'urgent', rush: 'urgent', asap: 'urgent',
  owner: 'own', owns: 'own', ownership: 'own', rights: 'own',
  commercially: 'commercial', monetize: 'commercial', monetise: 'commercial',
  upgrading: 'upgrade', upgraded: 'upgrade', switch: 'upgrade',
  stems: 'stem', instrumental: 'instrumental', instrumentals: 'instrumental', beat: 'instrumental', beats: 'instrumental',
  mastered: 'mastering', master: 'mastering', mastering: 'mastering',
  mixed: 'mixing', mix: 'mixing', mixing: 'mixing',
  plans: 'plan', packages: 'plan', package: 'plan', bundle: 'plan', bundles: 'plan',
  remotely: 'remote', online: 'remote',
  genres: 'genre', styles: 'genre', style: 'genre',
  credits: 'credit', credited: 'credit',
  artists: 'artist', singers: 'artist', singer: 'artist', rapper: 'artist',
  delivery: 'deliver', delivered: 'deliver', receive: 'deliver',
  days: 'time', weeks: 'time', duration: 'time', timeline: 'time', turnaround: 'time', long: 'time',
};

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ]+/g, ' ') // keep Devanagari so Hindi words aren't dropped
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w)))
    .map((w) => {
      const base = SYNONYMS[w] ?? stem(w);
      return SYNONYMS[base] ?? base;
    })
    .filter((w) => !STOPWORDS.has(w));
}

/** Lower-cased words only — used for whole-phrase aliases such as "what do you do". */
function plain(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();
}

// ── Index (built once) ─────────────────────────────────────────
const W_QUESTION = 1.0;
const W_KEYWORDS = 0.65;
const W_ANSWER = 0.2;

const docs = FAQS.map((faq) => {
  const weights = new Map();
  const add = (tokens, w) => {
    for (const t of tokens) weights.set(t, Math.max(weights.get(t) ?? 0, w));
  };
  add(tokenize(faq.a), W_ANSWER);
  add(tokenize(faq.k), W_KEYWORDS);
  add(tokenize(faq.q), W_QUESTION);
  const qTokens = tokenize(faq.q);
  return {
    faq,
    weights,
    normalizedQuestion: qTokens.join(' '),
    questionSize: new Set(qTokens).size || 1,
    aliases: (faq.alias ?? []).map(plain),
  };
});

const docFreq = new Map();
for (const d of docs) for (const t of d.weights.keys()) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
const N = docs.length;
const idf = (t) => Math.log((N + 1) / ((docFreq.get(t) ?? 0) + 0.5)) + 1; // unseen words get the highest idf

/** Score 0–1 per FAQ: share of the visitor's (idf-weighted) words that the FAQ covers. */
function rank(tokens, phrase) {
  const unique = [...new Set(tokens)];
  const total = unique.reduce((s, t) => s + idf(t), 0);
  const normalized = tokens.join(' ');
  return docs
    .map((d) => {
      if (phrase && d.aliases.includes(phrase)) return { faq: d.faq, score: 1 };
      if (!total) return { faq: d.faq, score: 0 };
      let got = 0;
      for (const t of unique) got += idf(t) * (d.weights.get(t) ?? 0);
      let score = got / total;
      if (normalized && normalized === d.normalizedQuestion) score = 1;
      else score += 0.02 / d.questionSize; // tie-break: prefer the FAQ whose question is more specific to these words
      return { faq: d.faq, score };
    })
    .sort((a, b) => b.score - a.score);
}

const MATCH_THRESHOLD = 0.42; // below this the question is treated as "not in our FAQs"
const RELATED_THRESHOLD = 0.25;

const GREETINGS = new Set(['hi', 'hello', 'hey', 'hii', 'hiii', 'helo', 'namaste', 'yo', 'sup', 'hola', 'greetings']);
const THANKS = new Set(['thanks', 'thank', 'thx', 'thankyou', 'ty', 'ok', 'okay', 'cool', 'great', 'nice', 'bye', 'goodbye', 'shukriya', 'dhanyavad', 'got', 'it']);

const FILLER = new Set(['there', 'good', 'morning', 'afternoon', 'evening', 'you', 'so', 'much', 'very', 'a', 'lot', 'team', 'star']);

/** True for short messages made only of `set` words (plus filler), e.g. "hello there", "thanks a lot". */
function isOnly(message, set) {
  const words = String(message).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 4 && words.some((w) => set.has(w)) && words.every((w) => set.has(w) || FILLER.has(w));
}

const toFaqPayload = (faq) => ({ id: faq.id, question: faq.q, answer: faq.a, category: faq.category });

/**
 * Decide what to do with a visitor's message.
 * → { type: 'greeting'|'thanks'|'faq'|'clarify'|'unknown', … }
 */
function answerMessage(message) {
  if (isOnly(message, GREETINGS)) return { type: 'greeting', answer: GREETING_REPLY };
  if (isOnly(message, THANKS)) return { type: 'thanks', answer: THANKS_REPLY };

  const tokens = tokenize(message);
  const ranked = rank(tokens, plain(message));
  const best = ranked[0];

  if (best && best.score >= MATCH_THRESHOLD) {
    const related = ranked
      .slice(1, 4)
      .filter((r) => r.score >= RELATED_THRESHOLD && r.score >= best.score * 0.6)
      .slice(0, 2)
      .map((r) => ({ id: r.faq.id, question: r.faq.q }));
    return { type: 'faq', faq: toFaqPayload(best.faq), related };
  }

  // Not a FAQ. A single stray word isn't a question worth emailing the team about.
  const words = String(message).trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || String(message).replace(/[^\p{L}\p{N}]/gu, '').length < 6) return { type: 'clarify' };
  return { type: 'unknown' };
}

function getFaq(id) {
  const faq = FAQS.find((f) => f.id === Number(id));
  return faq ? toFaqPayload(faq) : null;
}

return { FAQS: FAQS, POPULAR_FAQ_IDS: POPULAR_FAQ_IDS, GREETING_REPLY: GREETING_REPLY, THANKS_REPLY: THANKS_REPLY, answerMessage: answerMessage, getFaq: getFaq, tokenize: tokenize };
});
