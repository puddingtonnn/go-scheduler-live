# Прод-сценарии (mutex, leak) + показательность (URL-шаринг, статик-демо)

Дата: 2026-07-02 · План: `~/.claude/plans/delightful-juggling-shore.md`

## Проблема

Аудит реалистичности сценариев: gcpressure/syscalls/workstealing близки к проду,
pingpong — синтетика. Из частых прод-проблем не покрыты **contention** и **утечки
горутин**. Для показательности проекту не хватает шаринга ссылкой и живого демо
без бэкенда.

## Решение (3 слайса)

### A. Сценарии `mutex` и `leak`
- `mutex` («Горячий мьютекс»): N воркеров делят один `sync.Mutex`
  (hold 1.2мс / gap 200мкс) — бежит один, остальные в Waiting·sync. Contention
  сериализует работу сама, событий ~2–4k. Тест: ≥20 блоков с sync-reason.
- `leak` («Утечка горутин»): фоновые спиннеры держат станции живыми; капельница
  (busyFor 40мс) спавнит горутины, которые чуть работают и навсегда блокируются
  `<-ch` без писателя. Утекшие сознательно НЕ в WaitGroup (Run возвращается, они
  висят; в подпроцессе умирают с ним, в -race тесте безвредно висят до конца
  бинаря). Тест: у ≥N/2 горутин последнее событие — chan-block.
- Фронт не тронут: waiting-пилюля уже группирует «канал/sync/прочее»
  (`reason.ts`), рост показывают «+N» бейджи.

### B. URL-шаринг
- Чистый `web/src/share.ts`: `parseShare`/`buildShare`
  (`?scenario=&gomaxprocs=&goroutines=&t=`), не конфликтует с `?iso`. Vitest.
- `main.ts`: query на буте → выставить контролы, запустить, seek к `t` + pause;
  `history.replaceState` на run/pause/scrub (не во время play).

### C. Статик-демо (GitHub Pages)
- `cmd/bake`: прогоняет существующий конвейер (tracerun→traceparse→timeline) по
  матрице сценариев, пишет `web/public/runs/*.json` + `index.json`.
- Фронт: `VITE_STATIC=1` → `api.ts` читает index.json/запечённые прогоны;
  параметры — селекты доступных значений. `VITE_BASE` для Pages.
- `.github/workflows/pages.yml`: bake → build → deploy. JSON-ы не коммитятся.

## Вне скоупа
Backpressure/herd, гайд-тур, GC-довизуалы, эвристика кражи.
