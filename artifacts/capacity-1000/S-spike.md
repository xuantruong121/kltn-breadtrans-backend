## out/S-spike

DB=capacity PROFILE=S POOL=20 TWO=no CPUS=shared:0,1 K6_CPUSET=2-7 

| t (s) | VUs | req/s | p95 (ms) | errors | Mbps sent by server |
|---:|---:|---:|---:|---:|---:|
| 0 | 1000 | 54 | 24357 | 7.38% | 0.0 |
| 30 | 1000 | 8 | 29614 | 0.40% | 0.0 |
| 90 | 1000 | 0 | 1079 | 0.00% | 0.0 |
| 120 | 978 | 24 | 10183 | 0.28% | 2.8 |
| 150 | 158 | 5 | 13369 | 0.00% | 0.9 |

FIRST_BREAK=t0s VUS=1000 P95=24357ms ERRORS=7.38%

TOTAL requests=2758 failed=4.46% p95=26775ms p99=29115ms 5xx=123 data_received=13.9 MB

| endpoint | p95 (ms) | p99 (ms) | errors | MB |
|---|---:|---:|---:|---:|
| exam_begin | 18523 | 20635 | 0 | 0.2 |
| exam_start | 24768 | 25362 | 47 | 0.2 |
| exam_submit | 4134 | 4246 | 1 | 1.1 |
| listening_list | 29040 | 29700 | 32 | 4.1 |
| quiz_detail | 3602 | 18640 | 0 | 3.6 |
| quiz_submit | 12268 | 13412 | 1 | 0.6 |
| reading_list | 28933 | 29722 | 42 | 3.1 |

| container | peak CPU (% of one core) | peak memory (MB) | peak egress (Mbps) |
|---|---:|---:|---:|
| breadtrans-capacity-api-1 | 133 | 241.2 | 10.0 |
| breadtrans-capacity-caddy-1 | 8 | 125.6 | 10.0 |
| harness-redis | 3 | 8.8 | 0.1 |
| harness-pg | 74 | 312.0 | 20.0 |

PG_CONNECTIONS peak_active=2 peak_total=21
API_RUNTIME event_loop_p95_max=347ms cpu_max=140% rss_max=304.9MB pool_timeouts=8
