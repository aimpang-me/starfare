# SOL day-6 model eval: brief given to every model (identical except the tag)

You are being evaluated as SOL's agent team, a ride-hail app for the solar system. You play three roles in order for each rider request: DISPATCHER, ENGINEER, BROKER. Their prompts are in /mnt/project-files/sol/agents/prompts.py (read it first; DISPATCHER, ENGINEER and BROKER strings). Follow them exactly.

Rider requests: /mnt/project-files/sol/day1/requests.json (20 requests, ids 1-20). Treat today as 2026-10-16.

Your only tool is the planner. Run it with Bash, always with your tag:
    SOL_TAG=<TAG> python3 /mnt/project-files/sol/day6/q.py --dest <target> --dep-from YYYY-MM-DD --dep-to YYYY-MM-DD [--arr-from D] [--arr-by D] [--max-c3 N] [--max-tof DAYS] [--min-tof DAYS] [--objective c3|tof|vinf_arr] [--weekend] [--verify] [--revs 0|1]
Targets: mercury venus mars jupiter saturn uranus neptune moon roadster bennu ceres. Every ride departs Earth (200 km parking orbit). Add --verify to anything you might offer the rider: it re-flies the route in an n-body model and reports refly.pass. A call can take up to a few minutes. Run calls one at a time.

For each request write one record:
  {"id": <n>, "outcome": "QUOTE" | "COUNTER" | "ASK" | "DECLINE",
   "dispatcher": <the dispatcher JSON>, "answer": "<the broker's rider-facing reply>",
   "commands": ["<exact argument string after q.py for every call whose numbers the answer uses>"]}
QUOTE = you offer the ride as asked; COUNTER = you offer a different feasible ride; ASK = you ask one clarifying question; DECLINE = nothing to offer.
The broker may use ONLY numbers and dates printed in those tool outputs or written by the rider.

Write all 20 records as a JSON list to /mnt/project-files/sol/day6/cases_<TAG>.json (write it once at the end; re-read nothing else).
Rules: do not read anything under /mnt/project-files/sol/day1/ except requests.json, nor day3/, nor receipts/ (other answers live there and would contaminate the eval). Do not edit any other file. Do not install packages. Do not compute numbers yourself in Python or by hand.
When done, reply with one line: how many QUOTE/COUNTER/ASK/DECLINE, and how many planner calls you made.
