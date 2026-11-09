## out/C-head-spike

DB=cap_head PROFILE=S POOL=20 TWO=no CPUS=shared:0,1 K6_CPUSET=2-7 

| t (s) | VUs | req/s | p95 (ms) | errors | Mbps sent by server |
|---:|---:|---:|---:|---:|---:|
| 0 | 1000 | 5 | 239 | 0.00% | 0.0 |
| 30 | 1000 | 21 | 113 | 0.00% | 0.0 |
| 60 | 1000 | 24 | 134 | 0.00% | 0.0 |
| 90 | 1000 | 17 | 118 | 0.00% | 0.0 |
| 150 | 1000 | 15 | 1437 | 0.00% | 1.8 |
| 180 | 549 | 19 | 575 | 0.00% | 2.3 |

FIRST_BREAK=t150s VUS=1000 P95=1437ms ERRORS=0.00%

TOTAL requests=3000 failed=0.00% p95=780ms p99=1367ms 5xx=0 data_received=15.4 MB

| endpoint | p95 (ms) | p99 (ms) | errors | MB |
|---|---:|---:|---:|---:|
| exam_begin | 109 | 153 | 0 | 0.3 |
| exam_start | 182 | 271 | 0 | 0.2 |
| exam_submit | 1096 | 1360 | 0 | 1.1 |
| listening_list | 145 | 237 | 0 | 4.6 |
| quiz_detail | 69 | 145 | 0 | 4.1 |
| quiz_submit | 1241 | 1768 | 0 | 0.6 |
| reading_list | 150 | 221 | 0 | 3.5 |

| container | peak CPU (% of one core) | peak memory (MB) | peak egress (Mbps) |
|---|---:|---:|---:|
| breadtrans-capacity-caddy-1 | 6 | 76.0 | 2.0 |
| breadtrans-capacity-api-1 | 127 | 250.3 | 3.0 |
| harness-redis | 3 | 12.7 | 0.9 |
| harness-pg | 48 | 324.8 | 88.9 |

PG_CONNECTIONS peak_active=2 peak_total=21
API_RUNTIME event_loop_p95_max=112ms cpu_max=127% rss_max=301.5MB pool_timeouts=0
