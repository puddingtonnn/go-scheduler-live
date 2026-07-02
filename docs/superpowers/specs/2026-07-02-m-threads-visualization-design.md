# M-визуализация: OS-потоки в мире G·M·P

Дата: 2026-07-02 · Ветка: `feat/pixel-art` · План: `~/.claude/plans/delightful-juggling-shore.md`

## Проблема

Сцена показывала только G и P; интро честно говорило «M не рисуется». Но каждое
событие трейса несёт id исполняющего OS-потока (`exptrace.Event.Thread()`), а
lifecycle-событий M действительно нет. Значит M можно показать честно — как
реальные per-event данные (в отличие от реконструированной кражи), с оговоркой
«паркованные M невидимы».

## Решение (утверждено)

1. **Вид M** — пиксель-тележка («носитель») с биркой у P-станции, под бегущим
   гофером; при блокирующем syscall тележка уезжает в syscall-зону вместе со
   своим гофером, P получает другую тележку. Handoff виден буквально.
2. **Новый сценарий `syscalls`** — единственный способ увидеть handoff: старые
   сценарии нарочно CPU-paced и блокирующих syscall не делают.
3. **Только активные M** (у P или в syscall с G); паркованные исчезают, сноска
   в легенде.

## Семантика (ядро фичи)

`mid` эмитится сырым на каждом transition-событии (зеркало поведения `pid`),
интерпретация — на фронте, в чистом `stateAt`:

| событие | G.mid | P[pid].mid | почему |
|---|---|---|---|
| `g_create` | игнор | — | mid = M создателя |
| `g_run_start` | `e.mid` | `e.mid` | своё исполнение |
| `g_run_stop` / `g_block` / `g_exit` | сброс | не трогаем | M остаётся на P |
| `g_unblock` | сброс (НИКОГДА `e.mid`) | не трогаем | mid = M разбудившего; покрывает syscall→runnable |
| `g_syscall_enter` | `e.mid` | не трогаем | M уходит в ядро с G; P в `_Psyscall` до retake |
| `g_syscall_exit` | `e.mid` | `e.mid` | возвращается тот же M |
| `p_start` | — | `e.mid` | M забрал P |
| `p_stop` | — | сброс (игнор `e.mid`) | на ProcSteal это M вора |

Инварианты закреплены дважды: vitest (`state.test.ts`) и Go
(`TestSchedulerInvariants`: M ≤ 1 G, согласованность (P,M), тот-же-M на
syscall-exit).

## Ловушки, закреплённые тестами

- **Netpoller:** `os.Pipe` паркует G как Waiting без блокировки M. Сценарий
  использует сырые `syscall.Pipe`+`syscall.Read`. Анти-регрессия: ≥5
  `g_syscall_enter` и ≥2 разных MID на одном P (наблюдалось 400+ и до 13).
- **Гигантские ThreadID на darwin** (напр. 6103904256): на бирке — порядковый
  алиас по первому появлению (`midAliases`), реальный id в тултипе.

## Из чего состоит

- Бэкенд: `timeline.Event.MID` (не omitempty), `threadID()` в parser,
  `scenarios/syscalls.go` (`//go:build unix`, Order 2), M-инварианты в tracerun.
- Фронт: `mid` в DTO-зеркале и `stateAt`; `drawthread.ts`/`thread.ts` (спрайт),
  `placeThreads`+`midAliases` (layout, чистые, vitest); сцена — слой гоферов,
  `zIndex=y−0.5`, STW-frozen, тултипы; легенда/интро/сноска; кнопка «M».
- Харнесс: verify-controls 19/19; скриншоты `shoot-all.mjs` (syscalls).

## Вне скоупа (осознанно)

M-lifecycle-анимации сверх bind/travel/despawn; sysmon; LockOSThread; полка
«спящих M» (трейс не говорит, жив ли M).
