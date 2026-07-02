# gmp-model

Учебная визуализация планировщика Go (G–M–P) и GC «гоферами». Backend на Go
запускает курируемые сценарии под `runtime/trace`, парсит трейс через
`golang.org/x/exp/trace` в нормализованную `Timeline` (JSON); фронт (PixiJS,
отдельный срез) проигрывает её по виртуальным часам. **Источник правды — реальный
рантайм Go**, не выдуманная модель. План: `~/.claude/plans/keen-swinging-leaf.md`.

## Architecture decisions
- Трейс снимается в **отдельном подпроцессе** (`cmd/workload`), не in-process в
  сервере: изоляция от горутин сервера, per-run GOMAXPROCS, «чистый» трейс.
- `cmd/workload` пишет в **stdout только бинарный трейс**; любые логи/ошибки — в
  **stderr** (иначе поток трейса повреждается).
- GOMAXPROCS задаётся флагом `-gomaxprocs` (через `runtime.GOMAXPROCS` до
  `trace.Start`), не через `Params` сценария — это свойство рантайма.
- Границы пакетов: `scenarios` (только конкуренция) ⟂ `tracerun` (запуск→байты) ⟂
  `traceparse` (единственный знает `x/exp/trace`) ⟂ `timeline` (доменная модель/DTO)
  ⟂ `api` (HTTP/JSON).
- DTO `timeline.Event`: `gid`/`pid` = `-1` для «нет ресурса» (НЕ `omitempty` —
  `pid 0` и `gid 0` валидны).
- `api` принимает `TraceRunner` (функция-зависимость), а не импортирует поведение
  `tracerun` → тестируется фейком без подпроцесса. Кэш `Timeline` по ключу
  `scenario|gomaxprocs|goroutines|duration` под `sync.Mutex`.
- Конвейер запроса: `tracerun.Run` (subprocess, import-path `gmp-model/cmd/workload`)
  → `traceparse.Parse` → `timeline.Build`.

## HTTP API (backend-срез)
- `GET /api/scenarios` → `[]scenarios.ScenarioInfo`.
- `GET /api/run?scenario=&gomaxprocs=&goroutines=&duration=` → `timeline.Timeline`.
  Неизвестный сценарий → 404; параметры **клампятся, не отвергаются** (`goroutines`
  клампится по `ParamSpec` самого сценария, `gomaxprocs`∈[1,8], `duration`∈[100ms,10s]).
- `cmd/server -addr :8080` монтирует `api.New(tracerun.Run)`.

## Frontend (web/) — отдельный срез
- Стек: Vite + TypeScript + PixiJS (v8). Dev: `npm run dev`; сборка/тайпчек:
  `npm run build` (= `tsc --noEmit && vite build`); юнит-тесты: `npx vitest run`.
- Dev-прокси `/api` → бэкенд; таргет через `GMP_API_TARGET` (дефолт `:8080`). На
  машине пользователя `:8080` занят Docker → запускать
  `go run ./cmd/server -addr :8085` + `GMP_API_TARGET=http://localhost:8085 npm run dev`.
- Слои: `model/timeline.ts` (ручное зеркало Go-DTO) → `api.ts` → `player/`
  (чистый `stateAt(t)→WorldState` + класс `Player` — виртуальные часы) → `scene/`
  (PixiJS: дорожки-P, панель Global/Waiting/Syscall, легенда; гоферы по состоянию,
  кража = транзиентная вспышка) → `controls.ts` (DOM-бар) → `main.ts` (композиция,
  пере-запуск с pause старого Player + `scene.reset`).
- Чистая логика под vitest (`stateAt`, `placeAll`, `nextTime`); канвас-рендер — нет.
- Визуал проверяется headless: `scripts/shoot.mjs` (Playwright) — двигает плеер через
  `window.gmp` и пишет PNG (так визуал сверяется без участия человека).
- Время: `1x` = весь прогон за ~45с реального времени (нормализация к длительности;
  абсолютная длительность трейса — десятки мс).

## Frontend — pixel-art floor796 редизайн (ветка `feat/pixel-art`, в работе)
Переход с плоской сцены на **изометрию + пиксель-арт спрайты**. Дизайн-хэндофф:
`design_handoff_go_scheduler/` (README-спек + `screens/*.png` +
`Go Scheduler Pixel Style.dc.html` с процедурным кодом отрисовки). **Арт портируем из
него**, не внешние ассеты; floor796-редактор НЕ используем. План: `~/.claude/plans/keen-swinging-leaf.md`.
- Новые `web/src/scene/`: `palette.ts` (PAL ~28 hex), `drawgopher.ts` (`drawGopher` +
  `gopherCanvas` **44×44**, оверлеи zzz/…/!/ring **запечены** в текстуру состояния),
  `iso.ts` (проекция `(gx−gy)·12,(gx+gy)·6`; **база-мир 460×248** масштабируется под канвас;
  `stationPositions`/`drawStation`/`drawGrid`), `layout.ts`→`placeIso`, `demo.ts` (`?iso`).
- `scene.ts` переписан: изо-мир (grid+станции) + спрайт-гофер на gid из `WorldState`
  (текстура по состоянию, бейк, **NEAREST**), **depth-sort `zIndex=y`** + lerp; steal=красный
  спрайт+кольцо при `pulse`, STW=перекрас всех в `frozen`+виньетка. `gopher.ts` — спрайт-
  обёртка (anchor 0.5/0.886). **Бэкенд и `player/*` НЕ тронуты.**
- **Готово Ф1–Ф4.** Ф4 (chrome в DOM): новый слой `web/src/ui/` — `chrome.ts` (класс `Chrome`:
  заголовок «Планировщик Go · G·M·P», GC-индикатор, heap-бар с goal-маркером на 80%, плавающие
  pill-подписи зон, легенда, caption через `narrate`, сводка Ожидания через `reasonCategory`,
  DOM-баннер STW) + `derive.ts` (чистые `gcPhase`/`heapPct`/`waitingBreakdown` под vitest, по
  образцу `narrate.ts`/`reason.ts`). Текст — DOM (Pixelify Sans + JetBrains Mono, Google Fonts
  в `index.html`), пиксель-мир — Pixi. `scene.ts` отдаёт `worldToScreen()` + хук `onLayout` →
  pill-и трекают изо-кластеры при ресайзе/смене GOMAXPROCS (`Chrome.layout()`). `main.ts`
  перекомпонован: header / stage / legend / controls. Контролы перетемлены под палитру
  (CSS-only, логика `controls.ts` не тронута). **Бэкенд и `player/*` НЕ тронуты.** Слайс готов
  к коммиту + merge в `dev` (по просьбе).
- Тултип (DOM) и тоггл id (дочерний `Text`) сохранены и работают в новой сцене.

## Frontend — production-ready слайс (ветка `feat/pixel-art`)
Доводка до production-ready: реальные GMP+GC видны, все контролы работают, дизайн
яснее. Спек+совет: `docs/superpowers/specs/2026-06-30-production-ready-gmp-gc-design.md`.
- **Показ реального GC (главное).** Данные GC в трейсе настоящие, но при нормализации
  к 45с STW-паузы суб-кадровые → плеер их перешагивал. Новый чистый модуль
  `player/gc.ts` (`gcSummary` парсит реальные GC-диапазоны в циклы/STW-интервалы/
  `maxStwNs`, исключая `stop-the-world (start trace)` — это артефакт старта трейсера, не
  GC; `stwInWindow` ловит суб-кадровую STW в шаге `(lastT,t]`; `isPlaybackStep` +
  `STEP_WINDOW_PCT` — общий детектор «шаг проигрывания vs перемотка»). Chrome рисует
  **GC-strip** (to-scale полоса реальных STW-тиков + mark-полос + плейхед), счётчик
  циклов + «STW до Xмкс», heap-бар красится по фазе GC покадрово, фейковый маркер цели
  80% убран (полоса = live/goal, цель = правый край). STW в мире = **короткий блик**
  (~320мс): все гоферы белеют + красная виньетка + баннер, а в подписи — **реальная
  мкс/мс** («мир замер на 1.51 мс»). Принцип (совет): **никогда не показывать суб-мс STW
  длинной**.
- **Раскладка/сцена честнее и читабельнее.** `layout.ts`: `placeIso` → `Placement{x,y,scale}`,
  раскладка runnable по `gid % numProcs` (стабильно, сбалансировано; локальные очереди —
  реконструкция, помечено), переполнение лейна → глобальная очередь (как реальный рантайм
  льёт полный local runq в global). Зонные гоферы рисуются мельче (ZONE_SCALE), spacing
  под уменьшенный спрайт → нет «слипшейся каши». `scene.ts`: убран steal-подброс (раннеры
  стоят на P), кража = агрегатный амбер-глоу станции-получателя (из `stealBurst`), зонные
  платтеры/idle-P-маркер/проп-ы (лампа, ящик). Per-goroutine steal-вспышка удалена (была
  обманчива — почти все «украдены»); деталь «украдена (реконстр.)» осталась в тултипе.
- **Контролы/онбординг.** `step()` теперь пауза-затем-seek (это **единственная правка
  `player/*`** — корректность, не дизайн); play-кнопка/пробел синхронят лейбл; зажим
  `goroutines` по диапазону сценария; видимая ошибка вместо пустой страницы; подпись
  «чему учит сценарий» + dismissible intro-карточка; a11y (`aria-pressed`, `role`).
  Контракт «18/18 контролов» проверяется `web/scripts/verify-controls.mjs` (Playwright).
- **Бэкенд НЕ тронут**, `player/*` — только правка `step()`. Чистая логика (`gcSummary`,
  `isPlaybackStep`, `placeIso`, `narrate`) под vitest; визуал — харнессы `shoot*.mjs` +
  `verify-controls.mjs`.

## Frontend — аудит-слайс достоверности (ветка `feat/pixel-art`)
Глубокий многоагентный аудит (fidelity vs Go docs + новичок/эксперт + нижние логи). Итоги и
исправления:
- **Артефакт старта трейсера убран из фаз GC.** `stop-the-world (start trace)` больше не
  попадает в `gcActive` (`state.ts` фильтрует через `isTracerArtifact` из `gc.ts`) → заголовок/
  подпись на t=0 больше не врут «Stop-the-world» (проверено live: `GC: простой`, подпись пуста).
- **Окно нижней подписи масштабируется под длину трейса.** `narrate(..., windowNs?)` +
  `captionWindowNs(dur)=min(8мс, dur·1%)` (chrome его передаёт). Причина: workstealing ~39мс —
  фикс. 8мс = ~20% таймлайна ⇒ подпись «залипала» ~9с при 1x. STEAL_LOOKBACK_NS в сцене не тронут.
- **Баннер STW — по стенным часам, не по кадрам.** `chrome.stwBannerMs -= deltaMs` (performance.now),
  общий `STW_FLASH_MS` вынесен в `gc.ts` и разделён со сценой → одинаково на 60/120 Гц, в такт виньетке.
- **M честно оговорён:** трейс `x/exp/trace` M-события не отдаёт → бренд «G·M·P» оставлен, но интро
  объясняет «M — OS-поток, здесь не рисуется». Тултипы на легенду/зоны/GC-строку/кучу/GOMAXPROCS;
  сноска честности в легенде (cap 6 vs реальные 256, мягкая цель кучи, sweep/mark-assist опущены,
  даунсэмпл ≥2мс, ~25% CPU у mark-воркеров).
- **Правки затронули `player/*`** (`narrate.ts`, `gc.ts`, `state.ts` — выше «только step()» устарело).
  Бэкенд — только комментарий про лимит `maxProcs`. Отложено (осознанно): визуал overshoot кучи,
  показ 25% CPU в мире, переработка эвристики кражи. Всё зелёное: tsc, 67 vitest, `go test`,
  `vite build`, 18/18 `verify-controls`.

## Conventions
- `go.mod`: **go 1.25** (локально Go 1.26.2, `GOTOOLCHAIN=auto` — минор не форсим).
- Ошибки оборачиваем через `%w` с контекстом; sentinel-ошибки (`ErrNotFound`) для
  условий, на которые ветвятся вызыватели.
- Реестр сценариев — глобальный `map` + `Register` в `init()`; дубликат имени =
  `panic` (программная ошибка, видна на старте).
- Современный Go: range-over-int (`for i := range n`), встроенный `max`,
  per-iteration loop vars (поведение 1.22+).
- Код/идентификаторы/комментарии — английский; пользовательские строки
  (`Title`/`Description`) — русские.
- Git-флоу: интеграционная ветка `dev`, каждый слайс — своя ветка от `dev`, merge `--ff-only`,
  слитую ветку удаляем. Коммитим/пушим только по просьбе. Коммиты: лаконичный английский
  subject + краткий список главных изменений, **без вотермарка** (`Co-Authored-By` и т.п.;
  см. `~/.claude/CLAUDE.md`). Бэкенд-порт может занимать `:8080` (Docker) → сервер на `:8085`
  + `GMP_API_TARGET=http://localhost:8085 npm run dev`.

## Gotchas
- `golang.org/x/exp/trace` должен поддерживать версию формата трейса локального Go
  (заголовок файла — `go 1.26 trace`). Если `NewReader` ругается на версию —
  обновить `x/exp/trace`.
- testdata-трейс нельзя называть `*.out` (в `.gitignore`). Имя:
  `internal/traceparse/testdata/workstealing.trace`.
- Локальные очереди P и факт work-stealing трейс **прямо не даёт** → реконструируем
  эвристикой, помечаем флагом `Stolen`.
- Сценарии с каналами/аллокациями **без троттлинга дают миллионы событий** (трейс
  16 МБ за 400мс) → темп надо сбивать. Но **пейсить CPU-работой (`busyFor`), а не сном
  (`time.After`)**: сон паркует горутину в Waiting → платформы P пустые, сцена «мёртвая».
  `busyFor(d)` держит горутину Running (видно на P), wall-time-bounded → объём событий
  машинонезависим. pingpong гоняет `GOMAXPROCS` токенов (несколько активны разом).
- `traceparse` фильтрует range до значимых GC-фаз (`stop-the-world`, `mark phase`),
  отбрасывая шум (`incremental sweep`, `mark assist`); heap-метрики **даунсэмплятся**
  (≥2мс между сэмплами одного имени). Иначе gcpressure = десятки тысяч событий.
- `goEventType` обязан покрывать `Syscall→Runnable` (горутина вышла из syscall, но
  P уже забрали) → `g_unblock`; иначе она «залипает» в syscall. Корректность модели
  закреплена `TestSchedulerInvariants` (`tracerun`): на всех сценариях одновременно
  бегущих горутин = как в сыром трейсе и ≤ GOMAXPROCS, без двойных стартов/конфликтов P.
