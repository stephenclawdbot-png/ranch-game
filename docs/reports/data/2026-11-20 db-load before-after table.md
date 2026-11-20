| Request or page view | Before: queries (db ms) | After: queries (db ms) |
|---|---:|---:|
| GET / (signed out) [tick due] | 8 (13 ms) | 0 (0 ms) |
| GET / (signed out) | 2 (18.7 ms) | 0 (0 ms) |
| GET /races (signed out) [tick due] | 8 (13.1 ms) | 0 (0 ms) |
| GET /races (signed out) | 2 (5.2 ms) | 0 (0 ms) |
| GET /api/me (signed out) [tick due] | 0 (0 ms) | 0 (0 ms) |
| GET /api/me (signed out) | 0 (0 ms) | 0 (0 ms) |
| GET /api/races (signed out) [tick due] | 8 (35 ms) | 0 (0 ms) |
| GET /api/races (signed out) | 2 (8.8 ms) | 0 (0 ms) |
| GET /wiki [tick due] | 0 (0 ms) | 0 (0 ms) |
| GET /wiki | 0 (0 ms) | 0 (0 ms) |
| GET /wiki/quick-start [tick due] | 0 (0 ms) | 0 (0 ms) |
| GET /wiki/quick-start | 0 (0 ms) | 0 (0 ms) |
| GET /hall [tick due] | 10 (26.7 ms) | 10 (15.1 ms) |
| GET /hall | 4 (8.5 ms) | 0 (0 ms) |
| GET /api/hall [tick due] | 4 (12.8 ms) | 0 (0 ms) |
| GET /api/hall | 4 (28.5 ms) | 0 (0 ms) |
| GET /league [tick due] | 4 (51.1 ms) | 4 (5.3 ms) |
| GET /league | 4 (67.7 ms) | 0 (0 ms) |
| GET /api/league [tick due] | 3 (3.5 ms) | 0 (0 ms) |
| GET /api/league | 3 (3.3 ms) | 0 (0 ms) |
| GET /news [tick due] | 1 (2.5 ms) | 1 (3.2 ms) |
| GET /news | 1 (1.8 ms) | 0 (0 ms) |
| GET /api/news [tick due] | 1 (2.6 ms) | 0 (0 ms) |
| GET /api/news | 1 (1.3 ms) | 0 (0 ms) |
| GET /tipsters [tick due] | 0 (0 ms) | 0 (0 ms) |
| GET /tipsters | 0 (0 ms) | 0 (0 ms) |
| GET /api/tipsters [tick due] | 5 (9.5 ms) | 5 (11.1 ms) |
| GET /api/tipsters | 5 (21.2 ms) | 0 (0 ms) |
| GET /play [tick due] | 0 (0 ms) | 0 (0 ms) |
| GET /play | 0 (0 ms) | 0 (0 ms) |
| GET /race/<unknown> [tick due] | 11 (32.7 ms) | 10 (19.1 ms) |
| GET /race/<unknown> | 2 (7.9 ms) | 1 (1.2 ms) |
| POST /api/events (signed out, 1 page_view) [tick due] | 1 (2 ms) | 0 (0 ms) |
| POST /api/events (signed out, 1 page_view) | 1 (1 ms) | 0 (0 ms) |
| page view: / (signed out) | 10 (17.5 ms) | 0 (0 ms) |
| page view: /races (signed out) | 9 (303.4 ms) | 0 (0 ms) |
| page view: /wiki (signed out) | 1 (2 ms) | 0 (0 ms) |
| idle tab: / signed out, visible | 0 in 2 min (0/min) | 0 in 2 min (0/min) |
| POST /api/account (found a stable) | 100 (325.6 ms) | 88 (79.8 ms) |
| GET / (signed in) [tick due] | 9 (39.6 ms) | 3 (12.9 ms) |
| GET / (signed in) | 3 (35.5 ms) | 3 (14.7 ms) |
| GET /api/me [tick due] | 52 (194.4 ms) | 46 (46.5 ms) |
| GET /api/me | 42 (117.4 ms) | 42 (86.9 ms) |
| GET /api/home [tick due] | 106 (187.4 ms) | 106 (122 ms) |
| GET /api/home | 75 (183.5 ms) | 75 (65.1 ms) |
| GET /api/engage [tick due] | 19 (26 ms) | 19 (24.8 ms) |
| GET /api/engage | 19 (27.2 ms) | 19 (24.2 ms) |
| GET /api/social/home [tick due] | 4 (13.5 ms) | 4 (12 ms) |
| GET /api/social/home | 4 (26.4 ms) | 4 (12.9 ms) |
| GET /api/notifications/count [tick due] | 7 (32.3 ms) | 7 (8.8 ms) |
| GET /api/notifications/count | 3 (14.2 ms) | 3 (3.7 ms) |
| GET /api/notifications [tick due] | 4 (20.7 ms) | 4 (3.8 ms) |
| GET /api/notifications | 4 (6.2 ms) | 4 (4.9 ms) |
| GET /races (signed in) [tick due] | 9 (134.9 ms) | 3 (11.4 ms) |
| GET /races (signed in) | 3 (12.8 ms) | 3 (7.3 ms) |
| GET /api/races (signed in) [tick due] | 9 (25.4 ms) | 3 (7.2 ms) |
| GET /api/races (signed in) | 3 (6.9 ms) | 3 (6.9 ms) |
| GET /api/races/live-wait [tick due] | 50 (190 ms) | 27 (53.7 ms) |
| GET /api/races/live-wait | 44 (136.8 ms) | 27 (52.8 ms) |
| GET /stable [tick due] | 0 (0 ms) | 0 (0 ms) |
| GET /stable | 0 (0 ms) | 0 (0 ms) |
| GET /horse/[id] [tick due] | 40 (245.2 ms) | 19 (37.4 ms) |
| GET /horse/[id] | 40 (286.1 ms) | 19 (167.1 ms) |
| GET /api/horses/[id] [tick due] | 16 (87.6 ms) | 15 (27.6 ms) |
| GET /api/horses/[id] | 16 (62.9 ms) | 15 (32.8 ms) |
| GET /api/story [tick due] | 7 (14.4 ms) | 7 (9.5 ms) |
| GET /api/story | 7 (12 ms) | 7 (6.6 ms) |
| GET /api/picks/today [tick due] | 8 (42.6 ms) | 8 (12.9 ms) |
| GET /api/picks/today | 8 (19 ms) | 8 (13.6 ms) |
| POST /api/events (signed in, 1 page_view) [tick due] | 3 (17 ms) | 3 (3.3 ms) |
| POST /api/events (signed in, 1 page_view) | 3 (11.2 ms) | 3 (4.2 ms) |
| POST /api/races/quick (Story, instant) | 237 (429.8 ms) | 193 (185.4 ms) |
| GET /race/[id] (Story, finished) [tick due] | 34 (894.9 ms) | 13 (67.5 ms) |
| GET /race/[id] (Story, finished) | 8 (54.6 ms) | 4 (6.7 ms) |
| GET /api/races/[id] (Story, finished) [tick due] | 10 (25.9 ms) | 4 (6.7 ms) |
| GET /api/races/[id] (Story, finished) | 4 (13.8 ms) | 4 (5.3 ms) |
| GET /api/races/[id]/replay (finished) [tick due] | 1 (1.6 ms) | 1 (2 ms) |
| GET /api/races/[id]/replay (finished) | 1 (5.7 ms) | 1 (1.9 ms) |
| GET /api/races/[id]/live?w=0 (finished) [tick due] | 7 (23.5 ms) | 1 (1.3 ms) |
| GET /api/races/[id]/live?w=0 (finished) | 1 (6.2 ms) | 1 (1.2 ms) |
| GET /api/races/[id]/me (finished) [tick due] | 11 (52.1 ms) | 10 (10 ms) |
| GET /api/races/[id]/me (finished) | 11 (24.6 ms) | 10 (14.4 ms) |
| page view: / (signed in) | 292 (1129.1 ms) | 173 (190.2 ms) |
| page view: /races (signed in) | 60 (162.8 ms) | 61 (77 ms) |
| page view: /stable | 57 (182.2 ms) | 50 (56.5 ms) |
| page view: /horse/[id] | 170 (597.8 ms) | 140 (174.2 ms) |
| page view: /me | 66 (210.7 ms) | 59 (85.3 ms) |
| page view: /race/[id] (Story, finished) | 124 (344.8 ms) | 117 (195.9 ms) |
| POST /api/races/live-pick (enter a Live race) | 138 (349.1 ms) | 148 (168.2 ms) |
| GET /race/[id] (Live, entries open) [tick due] | 20 (103.9 ms) | 13 (23.3 ms) |
| GET /race/[id] (Live, entries open) | 12 (85.9 ms) | 6 (8.3 ms) |
| GET /api/races/[id] (Live, entries open) [tick due] | 12 (71.1 ms) | 6 (5.8 ms) |
| GET /api/races/[id] (Live, entries open) | 6 (9.1 ms) | 6 (8.8 ms) |
| GET /api/races/live-wait (entered) [tick due] | 18 (120.5 ms) | 12 (17.9 ms) |
| GET /api/races/live-wait (entered) | 12 (52.2 ms) | 12 (17.1 ms) |
| page view: /race/[id] (Live, entries open) | 171 (457.2 ms) | 155 (122.6 ms) |
| idle tab: / signed in, visible, race pending | 1270 in 3 min (423.3/min) | 233 in 3 min (77.7/min) |
| GET /race/[id] (Live, field locked) [tick due] | 236 (1644.4 ms) | 19 (140.6 ms) |
| GET /api/races/[id]/live?w=0 (before the off) | 2 (2.8 ms) | 2 (4.1 ms) |
| GET /race/[id] (Live, running) [tick due] | 8 (45.8 ms) | 13 (15.1 ms) |
| GET /race/[id] (Live, running) | 17 (123.6 ms) | 4 (14.9 ms) |
| GET /api/races/[id]/live?w=0 (running, complete window) | 1 (1.7 ms) | 1 (1.5 ms) |
| GET /api/races/[id]/live?w=1 (running) | 1 (9.9 ms) | 1 (1.4 ms) |
| GET /api/races (a race is live) | 3 (22.1 ms) | 50 (42.6 ms) |
| page: /race/[id] live for 30 s (one viewer) | 150 (507.4 ms) | 164 (238.9 ms) |
| GET /race/[id] (Live, finished) [tick due] | 16 (32.4 ms) | 4 (8.3 ms) |
| GET /race/[id] (Live, finished) | 8 (60.5 ms) | 4 (10.3 ms) |
| GET /api/races/[id] (Live, finished) [tick due] | 12 (35.5 ms) | 4 (9.5 ms) |
| GET /api/races/[id] (Live, finished) | 4 (7.2 ms) | 4 (9.5 ms) |
| GET /api/races/[id]/replay (Live, finished) [tick due] | 1 (2.6 ms) | 1 (2.6 ms) |
| GET /api/races/[id]/replay (Live, finished) | 1 (5.8 ms) | 23 (35.2 ms) |
| GET /api/races/[id]/live?w=0 (Live, finished) [tick due] | 9 (23.1 ms) | 1 (5.4 ms) |
| GET /api/races/[id]/live?w=0 (Live, finished) | 1 (5.9 ms) | 1 (1.3 ms) |
| page view: /race/[id] (Live, finished) | 128 (322.7 ms) | 151 (174.8 ms) |
| GET /race/[id] (Live, finished, signed out) [tick due] | 6 (531.1 ms) | 4 (5.9 ms) |
| GET /race/[id] (Live, finished, signed out) | 6 (110.6 ms) | 0 (0 ms) |
| idle tab: / signed in, visible | 266 in 3 min (88.7/min) | 48 in 2 min (24/min) |
| idle tab: / signed in, hidden | 265 in 3 min (88.3/min) | 0 in 2 min (0/min) |
| GET /api/cron/race-card | not measured | 146 (140.1 ms) |
| GET /api/cron/chain | not measured | 6 (5.1 ms) |
| idle tab: / signed in, visible, minutes 3-6 (no input) | not measured | 0 in 2 min (0/min) |
| idle tab: /races signed in, visible | not measured | 17 in 2 min (8.5/min) |
