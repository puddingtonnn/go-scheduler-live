import type { ScenarioInfo } from './model/timeline'
import type { ReasonCategory } from './player/reason'

// Tiny i18n layer: two static dictionaries (RU is the source of truth, EN must
// match its shape — enforced by `typeof RU`), a module-level current language
// persisted in localStorage, and translation helpers for the scenario metadata
// that arrives from the backend in Russian. Switching the language reloads the
// page (chrome/controls bake their strings at construction), so t() is read
// once per boot everywhere except the per-frame caption/log builders.
export type Lang = 'ru' | 'en'

const KEY = 'gmp.lang'

let lang: Lang = (() => {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'ru'
  } catch {
    return 'ru' // non-browser environment (vitest) or blocked storage
  }
})()

export function getLang(): Lang {
  return lang
}

export function setLang(l: Lang): void {
  lang = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    // headless/test environment — in-memory value is enough
  }
}

const RU = {
  units: { ns: 'нс', us: 'мкс', ms: 'мс' },

  chrome: {
    titleMain: 'Планировщик Go ',
    titleAccent: '· G·M·P',
    subtitleDefault: 'выберите сценарий ниже',
    gcTip: 'Фаза сборщика мусора: простой · конкурентная разметка (идёт вместе с горутинами) · stop-the-world (короткая пауза всего рантайма)',
    heapCap: 'куча',
    heapTip: 'Куча: живой размер как доля от цели GC (100% = цель). Цвет = фаза GC: серый — простой, бирюза — разметка, красный — STW',
    readout: (cycles: number, maxStw: string) => `${cycles} цикл. · STW до ${maxStw}`,
    readoutNone: 'циклов нет',
    banner: (dur: string) => `Stop-the-world: мир замер на ${dur}`,
    langBtn: 'EN',
    langTip: 'Switch the interface to English',
  },

  timeline: {
    tip: 'Хронология всего прогона: янтарь — плотность событий, бирюза — конкурентная разметка, красные тики — STW-паузы, ромбы — кражи. Клик/перетаскивание — переход',
    density: 'плотность событий',
    mark: 'парал. маркировка',
    stw: 'STW-пауза',
    steal: 'кража',
  },

  gcPhase: {
    idle: 'GC: простой',
    mark: 'GC: парал. маркировка',
    stw: 'GC: stop-the-world',
  },

  reasonCat: {
    канал: 'канал',
    сон: 'сон',
    sync: 'sync',
    GC: 'GC',
    прочее: 'прочее',
  } as Record<ReasonCategory, string>,

  legend: [
    ['Выполняется', 'Горутина бежит на P — прямо сейчас занимает слот выполнения'],
    ['В очереди', 'Готова бежать, ждёт свободный P (runnable)'],
    ['Ожидание', 'Заблокирована: канал, sync, сон, GC-ассист — P не занимает'],
    ['Syscall', 'Вызов ОС; на время syscall P отвязывается и может уйти другому потоку (M)'],
    ['M — OS-поток', 'OS-поток: тележка с номером у P-станции и под горутиной в syscall. Id настоящие, из трейса; блокирующий syscall уводит M вместе с горутиной, P достаётся другому M'],
    ['GC mark', 'Конкурентная разметка: GC работает ОДНОВРЕМЕННО с горутинами (это не пауза)'],
    ['STW', 'Stop-the-world: рантайм замирает на десятки мкс, чтобы завершить фазу GC'],
    ['Завершён', 'Горутина отработала и исчезает'],
  ] as ReadonlyArray<readonly [string, string]>,

  legendHint: 'колесо — зум · перетаскивание — панорама · двойной клик — сбросить вид',

  pills: {
    pstation: ['P-станции · выполнение', 'Слоты выполнения (=GOMAXPROCS); на каждом не больше одной бегущей горутины'],
    local: ['локальные очереди', 'Горутины, приписанные к своему P — реконструкция (рантайм очереди не пишет)'],
    global: ['Глобальная очередь', 'Горутины без своего P или перелившиеся из полной локальной очереди'],
    waiting: ['Ожидание', 'Заблокированные горутины: канал, sync, сон, GC-ассист — P не занимают'],
    syscall: ['Syscall', 'Горутины в системном вызове ОС; M уходит вместе с горутиной, а P достаётся другому M'],
  } as Record<string, readonly [string, string]>,

  assumptions: {
    summary: 'Допущения: что в этом мире условно, а что — настоящие данные трейса',
    groups: [
      [
        'Реконструкция — рантайм этого не записывает',
        [
          'Состав очередей: горутины приписаны к «своему» P условно (стабильная раскладка). Реальную локальную очередь (256 слотов + приоритетный runnext — он не показан) трейс не отдаёт.',
          'Кража работы — эвристика «стала runnable на одном P, побежала на другом». Бывают ложные срабатывания (подбор из глобальной очереди, возврат из syscall) — потому везде пометка «(реконстр.)».',
          'При пробуждении трейс называет P будильщика — в чью очередь встала горутина, неизвестно.',
        ],
      ],
      [
        'Масштаб и время',
        [
          'Скорость 1× — весь прогон за ~90 с; реальный трейс длится десятки миллисекунд. Всё замедлено в тысячи раз, перемещения гоферов — анимация.',
          'STW-вспышка растянута до ~⅓ секунды, чтобы её было видно; реальная пауза — микросекунды-миллисекунды (честная цифра — в подписи).',
          'В лейне P видны 6 горутин, остальные — бейдж «+N» или глобальная очередь.',
        ],
      ],
      [
        'Опущено',
        [
          'GC: фазы sweep и mark-assist; то, что фоновые mark-воркеры забирают ~25% CPU; цель кучи мягкая — реальная куча может её превышать.',
          'Причина вытеснения с P (трейс её не пишет), netpoller и sysmon как отдельные сущности, внутренности аллокатора (gFree, mcache).',
          'Запаркованные M: их жизненного цикла в трейсе нет — тележка просто исчезает. На бирке — порядковый номер, реальный id ОС — в тултипе.',
        ],
      ],
      [
        'Данные и сценарии',
        [
          'Кривая кучи даунсэмплена: точки не чаще раза в 2 мс.',
          'Сценарии нарочно замедлены CPU-работой, чтобы поток событий был обозримым, — продовый код так не пишут.',
        ],
      ],
    ] as ReadonlyArray<readonly [string, readonly string[]]>,
    real: 'Настоящее — всё остальное, напрямую из runtime/trace: события и их время, состояния горутин, привязки P и M, циклы GC и длительности STW, метрики кучи, причины блокировок.',
  },

  controls: {
    play: 'Играть',
    pause: 'Пауза',
    step: 'Шаг',
    run: 'Запустить',
    running: 'Запуск…',
    ariaBar: 'управление проигрыванием',
    ariaScrub: 'позиция во времени',
    ariaRun: 'запустить выбранный сценарий',
    idTip: 'показать номера горутин',
    mTip: 'показать OS-потоки (M)',
    logLabel: 'лог',
    logTip: 'показать журнал событий',
    scenario: 'сценарий',
    scenarioCap: 'СЦЕНАРИЙ',
    goroutines: 'горутины',
    procsTip: 'GOMAXPROCS — число P (слотов выполнения). Ограничено 1–8 под размер изо-сцены',
    gorTip: 'Сколько горутин запустить в сценарии (диапазон зависит от сценария)',
    ms: 'мс',
  },

  intro: {
    defaultTitle: 'Планировщик Go',
    gotIt: 'Понятно',
    primer:
      '<b>G</b> — горутина (один гофер = одна горутина), <b>P</b> — платформа: слот выполнения (их =GOMAXPROCS). ' +
      'Горутина бежит, только стоя на P; заблокированная — уходит вниз в зоны ожидания. ' +
      '<b>M</b> — OS-поток (тележка с номером): id настоящие, из трейса. В блокирующем syscall M уходит вместе с горутиной, а P получает новый M; запаркованные M не рисуются. ' +
      'Внизу — подпись, что происходит сейчас, и журнал событий. ' +
      'Колесо мыши приближает мир (id читаются вблизи), перетаскивание двигает, двойной клик — весь мир. ' +
      'Мир — реконструкция поверх настоящего трейса: что условно, а что факт — в «Допущениях» под легендой. ',
  },

  boot: {
    noScenarios: 'сервер не вернул ни одного сценария',
    loadFail: 'Не удалось загрузить сценарии',
    backendHint: (m: string) => `${m} — запустите бэкенд (go run ./cmd/server -addr :8085) и обновите страницу.`,
    retry: 'Повторить',
    runError: (m: string) => `Ошибка запуска: ${m}. Проверьте, что бэкенд запущен.`,
  },

  api: {
    demoIndex: (status: number) => `демо-индекс: HTTP ${status}`,
    demoRun: (status: number) => `демо-прогон: HTTP ${status}`,
    noBaked: (scenario: string) => `в демо нет запечённого прогона для «${scenario}»`,
  },

  narrate: {
    stw: 'Stop-the-world: все горутины замерли',
    mark: 'GC: фаза разметки (concurrent mark)',
    steal: (pid: number, count: number) => `P${pid} забрал ${count} ${pluralGorRu(count)}`,
    sysEnter: (gid: number, mName: string | null) =>
      `G${gid} ушла в syscall${mName ? ` — ${mName} блокируется с ней в ядре` : ''}`,
    sysExit: (gid: number, pid: number) => `G${gid} вернулась из syscall на P${pid}`,
    block: (gid: number, reason: string) => `G${gid} заблокирован: ${reason}`,
    exit: (gid: number) => `G${gid} завершилась`,
  },

  log: {
    header: 'журнал событий',
    headerTip: 'Все события трейса (кроме heap-метрик). Строка сверху показывает только самое заметное; здесь — всё.',
    cats: { sched: 'план', wait: 'ожид', syscall: 'syscall', gc: 'GC', proc: 'P' } as Record<string, string>,
    created: (gid: number, by: number | undefined) => `G${gid} создана${by !== undefined ? ` горутиной G${by}` : ''}`,
    whyFirst: (dur: string) => ` — ждала ${dur} (первый запуск)`,
    whyAfterSyscall: (dur: string) => ` — ждала ${dur} (после syscall)`,
    whyWoken: (dur: string, waker: number | undefined) =>
      ` — ждала ${dur}${waker !== undefined ? ` (разбужена G${waker})` : ''}`,
    gotP: (gid: number, pid: number, m: string | null, stolen: boolean, why: string) =>
      `G${gid} встала на P${pid}${m ? ` · ${m}` : ''}${stolen ? ' · украдена (реконстр.)' : ''}${why}`,
    offP: (gid: number, pid: number, ran: string | null) =>
      `G${gid} слезла с P${pid} — в очередь${ran ? ` (бежала ${ran})` : ''}`,
    blocked: (gid: number, reason: string | undefined, ran: string | null) =>
      `G${gid} заблокирована${reason ? `: ${reason}` : ''}${ran ? ` (бежала ${ran})` : ''}`,
    sysReturnNoP: (gid: number, dur: string) =>
      `G${gid} вернулась из syscall — свободного P нет, в очередь (в ядре ${dur})`,
    woken: (gid: number, by: number | undefined, reason: string | undefined, dur: string | null) =>
      `G${gid} разбужена${by !== undefined ? ` горутиной G${by}` : ''}${
        dur ? ` — ждала${reason ? ` «${reason}»` : ''} ${dur}` : ''
      }`,
    sysEnter: (gid: number, m: string | null) => `G${gid} ушла в syscall${m ? ` — ${m} блокируется с ней` : ''}`,
    sysExit: (gid: number, pid: number, dur: string | null) =>
      `G${gid} вернулась из syscall на P${pid}${dur ? ` (в ядре ${dur})` : ''}`,
    exited: (gid: number, lived: string | null) => `G${gid} завершилась${lived ? ` (жила ${lived})` : ''}`,
    pStart: (pid: number, m: string | null) => `P${pid} запущен${m ? ` · ${m}` : ''}`,
    pStopRetake: (pid: number, m: string, gid: number) =>
      `P${pid} остановлен — его ${m} заблокирован в syscall с G${gid}, P уходит другому M`,
    pStop: (pid: number) => `P${pid} остановлен`,
    gcBegin: (name: string) => `GC: ${name} — начало`,
    gcEnd: (name: string) => `GC: ${name} — конец`,
  },

  scene: {
    states: { running: 'бежит', runnable: 'готова', waiting: 'ждёт', syscall: 'syscall', dead: 'завершилась' } as Record<string, string>,
    stolenTip: ' · украдена (реконстр.)',
    mName: (alias: number, mid: number) => `M${alias} • OS-поток (id ${mid})`,
    inSyscallWith: (gid: number) => ` · в syscall с G${gid}`,
    boundTo: (pid: number) => ` · привязан к P${pid}`,
    carries: (gid: number) => ` · несёт G${gid}`,
  },
}

export type Strings = typeof RU

const EN: Strings = {
  units: { ns: 'ns', us: 'µs', ms: 'ms' },

  chrome: {
    titleMain: 'Go Scheduler ',
    titleAccent: '· G·M·P',
    subtitleDefault: 'pick a scenario below',
    gcTip: 'Garbage-collector phase: idle · concurrent mark (runs alongside goroutines) · stop-the-world (a brief pause of the whole runtime)',
    heapCap: 'heap',
    heapTip: 'Heap: live size as a fraction of the GC goal (100% = goal). Color = GC phase: gray — idle, teal — mark, red — STW',
    readout: (cycles: number, maxStw: string) => `${cycles} cycles · STW up to ${maxStw}`,
    readoutNone: 'no cycles',
    banner: (dur: string) => `Stop-the-world: the world froze for ${dur}`,
    langBtn: 'RU',
    langTip: 'Переключить интерфейс на русский',
  },

  timeline: {
    tip: 'Timeline of the whole run: amber — event density, teal — concurrent mark, red ticks — STW pauses, diamonds — steals. Click/drag to seek',
    density: 'event density',
    mark: 'concurrent mark',
    stw: 'STW pause',
    steal: 'steal',
  },

  gcPhase: {
    idle: 'GC: idle',
    mark: 'GC: concurrent mark',
    stw: 'GC: stop-the-world',
  },

  reasonCat: {
    канал: 'chan',
    сон: 'sleep',
    sync: 'sync',
    GC: 'GC',
    прочее: 'other',
  } as Record<ReasonCategory, string>,

  legend: [
    ['Running', 'The goroutine runs on a P — it occupies an execution slot right now'],
    ['Queued', 'Ready to run, waiting for a free P (runnable)'],
    ['Waiting', 'Blocked: channel, sync, sleep, GC assist — takes no P'],
    ['Syscall', 'An OS call; for its duration the P detaches and may go to another thread (M)'],
    ['M — OS thread', 'OS thread: the numbered carrier at a P station and under a goroutine in a syscall. Ids are real, from the trace; a blocking syscall takes the M away with the goroutine, the P goes to another M'],
    ['GC mark', 'Concurrent mark: the GC works AT THE SAME TIME as goroutines (this is not a pause)'],
    ['STW', 'Stop-the-world: the runtime freezes for tens of µs to finish a GC phase'],
    ['Done', 'The goroutine finished and disappears'],
  ] as ReadonlyArray<readonly [string, string]>,

  legendHint: 'wheel — zoom · drag — pan · double-click — reset view',

  pills: {
    pstation: ['P stations · running', 'Execution slots (=GOMAXPROCS); at most one running goroutine on each'],
    local: ['local queues', 'Goroutines assigned to their P — a reconstruction (the runtime does not record queues)'],
    global: ['Global queue', 'Goroutines without their own P, or spilled from a full local queue'],
    waiting: ['Waiting', 'Blocked goroutines: channel, sync, sleep, GC assist — they take no P'],
    syscall: ['Syscall', 'Goroutines inside an OS system call; the M leaves with the goroutine and the P goes to another M'],
  } as Record<string, readonly [string, string]>,

  assumptions: {
    summary: 'Assumptions: what is stylized in this world and what is real trace data',
    groups: [
      [
        'Reconstruction — the runtime does not record this',
        [
          'Queue membership: goroutines are assigned to “their” P by convention (a stable layout). The real local run queue (256 slots + the priority runnext slot — not shown) is absent from the trace.',
          'Work stealing is a heuristic: “became runnable on one P, ran on another”. It has false positives (global-queue pickups, syscall returns) — hence the “(reconstr.)” mark everywhere.',
          'On wakeup the trace names the waker’s P — which queue the goroutine actually joined is unknown.',
        ],
      ],
      [
        'Scale and time',
        [
          'Speed 1× — the whole run in ~90 s; the real trace lasts tens of milliseconds. Everything is slowed thousands of times, gopher movement is animation.',
          'The STW flash is stretched to ~⅓ s to be visible; the real pause is microseconds-to-milliseconds (the honest number is in the caption).',
          'A P lane shows 6 goroutines; the rest go to the “+N” badge or the global queue.',
        ],
      ],
      [
        'Omitted',
        [
          'GC: sweep and mark-assist phases; the ~25% of CPU taken by background mark workers; the heap goal is soft — the real heap may overshoot it.',
          'The reason for preemption off a P (the trace does not record it), netpoller and sysmon as entities, allocator internals (gFree, mcache).',
          'Parked M’s: the trace has no M lifecycle — the carrier simply disappears. The tag shows an ordinal; the real OS id is in the tooltip.',
        ],
      ],
      [
        'Data and scenarios',
        [
          'The heap curve is downsampled: points at most once per 2 ms.',
          'Scenarios are deliberately paced with CPU work to keep the event stream readable — production code is not written like this.',
        ],
      ],
    ] as ReadonlyArray<readonly [string, readonly string[]]>,
    real: 'Everything else is real, straight from runtime/trace: events and their timing, goroutine states, P and M bindings, GC cycles and STW durations, heap metrics, block reasons.',
  },

  controls: {
    play: 'Play',
    pause: 'Pause',
    step: 'Step',
    run: 'Run',
    running: 'Running…',
    ariaBar: 'playback controls',
    ariaScrub: 'position in time',
    ariaRun: 'run the selected scenario',
    idTip: 'show goroutine ids',
    mTip: 'show OS threads (M)',
    logLabel: 'log',
    logTip: 'show the event log',
    scenario: 'scenario',
    scenarioCap: 'SCENARIO',
    goroutines: 'goroutines',
    procsTip: 'GOMAXPROCS — the number of P (execution slots). Limited to 1–8 to fit the iso scene',
    gorTip: 'How many goroutines the scenario starts (the range depends on the scenario)',
    ms: 'ms',
  },

  intro: {
    defaultTitle: 'Go Scheduler',
    gotIt: 'Got it',
    primer:
      '<b>G</b> — a goroutine (one gopher = one goroutine), <b>P</b> — a platform: an execution slot (there are GOMAXPROCS of them). ' +
      'A goroutine runs only while standing on a P; a blocked one moves down to the waiting zones. ' +
      '<b>M</b> — an OS thread (the numbered carrier): ids are real, from the trace. In a blocking syscall the M leaves together with the goroutine and the P gets a new M; parked M’s are not drawn. ' +
      'At the bottom — a caption of what is happening now, and the event log. ' +
      'Mouse wheel zooms the world (ids are readable up close), dragging pans, double click — the whole world. ' +
      'The world is a reconstruction over a real trace: see “Assumptions” under the legend for what is stylized and what is fact. ',
  },

  boot: {
    noScenarios: 'the server returned no scenarios',
    loadFail: 'Failed to load scenarios',
    backendHint: (m: string) => `${m} — start the backend (go run ./cmd/server -addr :8085) and reload the page.`,
    retry: 'Retry',
    runError: (m: string) => `Run failed: ${m}. Check that the backend is up.`,
  },

  api: {
    demoIndex: (status: number) => `demo index: HTTP ${status}`,
    demoRun: (status: number) => `demo run: HTTP ${status}`,
    noBaked: (scenario: string) => `the demo has no baked run for “${scenario}”`,
  },

  narrate: {
    stw: 'Stop-the-world: all goroutines frozen',
    mark: 'GC: mark phase (concurrent mark)',
    steal: (pid: number, count: number) => `P${pid} grabbed ${count} goroutine${count === 1 ? '' : 's'}`,
    sysEnter: (gid: number, mName: string | null) =>
      `G${gid} entered a syscall${mName ? ` — ${mName} blocks with it in the kernel` : ''}`,
    sysExit: (gid: number, pid: number) => `G${gid} returned from syscall to P${pid}`,
    block: (gid: number, reason: string) => `G${gid} blocked: ${reason}`,
    exit: (gid: number) => `G${gid} finished`,
  },

  log: {
    header: 'event log',
    headerTip: 'All trace events (except heap metrics). The caption above shows only the most salient; here is everything.',
    cats: { sched: 'sched', wait: 'wait', syscall: 'syscall', gc: 'GC', proc: 'P' } as Record<string, string>,
    created: (gid: number, by: number | undefined) => `G${gid} created${by !== undefined ? ` by goroutine G${by}` : ''}`,
    whyFirst: (dur: string) => ` — waited ${dur} (first run)`,
    whyAfterSyscall: (dur: string) => ` — waited ${dur} (after syscall)`,
    whyWoken: (dur: string, waker: number | undefined) =>
      ` — waited ${dur}${waker !== undefined ? ` (woken by G${waker})` : ''}`,
    gotP: (gid: number, pid: number, m: string | null, stolen: boolean, why: string) =>
      `G${gid} got P${pid}${m ? ` · ${m}` : ''}${stolen ? ' · stolen (reconstr.)' : ''}${why}`,
    offP: (gid: number, pid: number, ran: string | null) =>
      `G${gid} stepped off P${pid} — back to the queue${ran ? ` (ran ${ran})` : ''}`,
    blocked: (gid: number, reason: string | undefined, ran: string | null) =>
      `G${gid} blocked${reason ? `: ${reason}` : ''}${ran ? ` (ran ${ran})` : ''}`,
    sysReturnNoP: (gid: number, dur: string) =>
      `G${gid} returned from syscall — no free P, queued (in kernel ${dur})`,
    woken: (gid: number, by: number | undefined, reason: string | undefined, dur: string | null) =>
      `G${gid} woken${by !== undefined ? ` by goroutine G${by}` : ''}${
        dur ? ` — waited${reason ? ` “${reason}”` : ''} ${dur}` : ''
      }`,
    sysEnter: (gid: number, m: string | null) => `G${gid} entered a syscall${m ? ` — ${m} blocks with it` : ''}`,
    sysExit: (gid: number, pid: number, dur: string | null) =>
      `G${gid} returned from syscall to P${pid}${dur ? ` (in kernel ${dur})` : ''}`,
    exited: (gid: number, lived: string | null) => `G${gid} finished${lived ? ` (lived ${lived})` : ''}`,
    pStart: (pid: number, m: string | null) => `P${pid} started${m ? ` · ${m}` : ''}`,
    pStopRetake: (pid: number, m: string, gid: number) =>
      `P${pid} stopped — its ${m} is stuck in a syscall with G${gid}, the P goes to another M`,
    pStop: (pid: number) => `P${pid} stopped`,
    gcBegin: (name: string) => `GC: ${name} — begin`,
    gcEnd: (name: string) => `GC: ${name} — end`,
  },

  scene: {
    states: { running: 'running', runnable: 'ready', waiting: 'waiting', syscall: 'syscall', dead: 'finished' } as Record<string, string>,
    stolenTip: ' · stolen (reconstr.)',
    mName: (alias: number, mid: number) => `M${alias} • OS thread (id ${mid})`,
    inSyscallWith: (gid: number) => ` · in syscall with G${gid}`,
    boundTo: (pid: number) => ` · bound to P${pid}`,
    carries: (gid: number) => ` · carries G${gid}`,
  },
}

export function t(): Strings {
  return lang === 'en' ? EN : RU
}

// pluralGorRu returns the Russian plural form of "горутина" for n (accusative);
// mirrors player/steal.ts pluralGor, kept here so the dictionary is self-contained.
function pluralGorRu(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'горутину'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'горутины'
  return 'горутин'
}

// The backend ships scenario titles/descriptions in Russian; the EN texts live
// here, keyed by scenario id, with a graceful fallback to the backend strings
// for scenarios this map does not know yet.
const SCENARIO_EN: Record<string, { title: string; description: string }> = {
  workstealing: {
    title: 'Work stealing',
    description: 'Many short CPU goroutines. With GOMAXPROCS>1 idle Ps steal goroutines from busy ones.',
  },
  pingpong: {
    title: 'Channels (ping-pong)',
    description: 'A ring of goroutines passes tokens over channels: a few run, the rest wait on chan receive.',
  },
  gcpressure: {
    title: 'GC pressure (allocations)',
    description: 'Goroutines churn garbage fast: the heap grows and the GC runs in cycles with mark and stop-the-world phases.',
  },
  syscalls: {
    title: 'Blocking syscalls (M handoff)',
    description: 'Goroutines block in real syscall reads from a pipe: the M blocks with the goroutine, sysmon retakes the P and hands it to another M.',
  },
  mutex: {
    title: 'Hot mutex (contention)',
    description: 'N workers share one sync.Mutex: the critical section serializes the work — one runs, the rest wait, no matter how many Ps there are.',
  },
  leak: {
    title: 'Goroutine leak',
    description: 'Some goroutines wait on a channel nobody ever writes to: the Waiting zone only grows — this is what a production leak looks like.',
  },
}

export function scenarioTitle(info: ScenarioInfo | undefined): string {
  if (!info) return ''
  if (lang === 'en') return SCENARIO_EN[info.id]?.title ?? info.title
  return info.title
}

export function scenarioDesc(info: ScenarioInfo | undefined): string {
  if (!info) return ''
  if (lang === 'en') return SCENARIO_EN[info.id]?.description ?? info.description
  return info.description
}
