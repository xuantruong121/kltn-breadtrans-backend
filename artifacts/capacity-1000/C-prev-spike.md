## out/C-prev-spike

DB=cap_prev PROFILE=S POOL=20 TWO=no CPUS=shared:0,1 K6_CPUSET=2-7 

| t (s) | VUs | req/s | p95 (ms) | errors | Mbps sent by server |
|---:|---:|---:|---:|---:|---:|
| 0 | 1000 | 11 | 195 | 0.00% | 0.0 |
| 30 | 1000 | 22 | 194 | 0.00% | 0.0 |
| 60 | 1000 | 23 | 236 | 0.00% | 0.0 |
| 90 | 1000 | 12 | 308 | 0.00% | 0.0 |
| 150 | 1000 | 11 | 10382 | 10.76% | 1.2 |
| 180 | 635 | 22 | 15834 | 26.83% | 2.8 |

FIRST_BREAK=t150s VUS=1000 P95=10382ms ERRORS=10.76%

TOTAL requests=3000 failed=7.10% p95=12354ms p99=16038ms 5xx=213 data_received=15.1 MB

| endpoint | p95 (ms) | p99 (ms) | errors | MB |
|---|---:|---:|---:|---:|
| exam_begin | 177 | 323 | 0 | 0.3 |
| exam_start | 294 | 662 | 0 | 0.2 |
| exam_submit | 6948 | 7640 | 87 | 0.8 |
| listening_list | 272 | 585 | 0 | 4.6 |
| quiz_detail | 120 | 215 | 0 | 4.2 |
| quiz_submit | 15815 | 18544 | 126 | 0.6 |
| reading_list | 243 | 371 | 0 | 3.5 |

| container | peak CPU (% of one core) | peak memory (MB) | peak egress (Mbps) |
|---|---:|---:|---:|
| breadtrans-capacity-caddy-1 | 17 | 91.2 | 10.0 |
| breadtrans-capacity-api-1 | 133 | 256.8 | 10.0 |
| harness-redis | 3 | 11.7 | 0.9 |
| harness-pg | 70 | 336.8 | 80.0 |

PG_CONNECTIONS peak_active=4 peak_total=21
API_RUNTIME event_loop_p95_max=170ms cpu_max=136% rss_max=313.2MB pool_timeouts=453
