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
