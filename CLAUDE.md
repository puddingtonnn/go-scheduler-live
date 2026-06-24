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
