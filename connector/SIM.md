# Run simulated rides locally

One command from the `connector` directory prints one report of simulated rides.

```
npm run sim
npm run sim -- --policies naive,careful --seeds 1,2,3,4 --hails iss-crew,titan-home
npm run sim -- --skill mid --noise 0 --policies naive --seeds 1 --hails iss-crew
```

`package.json` defines `"sim": "node sim.mjs"`. That script is not part of `npm test`. `node --test test/sim-policy.test.mjs` checks the Ceres wait, the skill flags, and that a 100 point total need not equal the rounded parts. That file is not part of `npm test` either.

The command prints one report and exits 0. A hard check exits 1. When the careful landed mean is below the naive landed mean, the report includes a finding, and the process still exits 0. Stdout is the whole shipped text.

If the copy scan fails, the command prints one line and does not print the table.

```
Simulated report withheld because the copy scan failed.
```

The process exits 1.

```javascript
import { POLICY_NAMES, formatReport, simulate } from "./sim.mjs";

const report = await simulate();
process.stdout.write(formatReport(report));
```

```javascript
const paired = await simulate({
  policies: ["naive", "careful"],
  seeds: ["1", "2"],
  hails: ["iss-crew", "titan-home"],
});
```

`paired.finding` is null, or an object with `careful`, `naive`, and `text`. `paired.rows` has one row per policy, seed, and hail, in that order.

`POLICY_NAMES` is `["naive", "careful", "random", "bad"]`.

`simulate()` with no argument plays those four policies on hazard seeds `"1"` through `"4"` and on every catalog hail, in the order `listHails` returns them. Each cell is one simulated ride. The catalog call returns the real catalog. The cell then takes the hail it was given. Naive takes the first legal ship. It does not rank the catalog or the forecasts. Careful plans a pickup for every legal ship, then plans the ride, and keeps the earliest pickup whose ride also plans and whose two legs fit in the ship's xenon tank. A ship is skipped when `plan_pickup` or `plan_ride` fails, or when the xenon on those two legs is more than the tank. The fleet listing is the list of ships it may plan.

The first line of the report is the header. The next line names the skill tier. Then, when a ride lands, a line `Score out of N.` N is the engine `out_of`, 100 on this branch and 100000 when the engine scores that way. The score call passes `ship`, `window_kwh`, `throttled_kwh`, and `hindsight_kwh`. Columns are separated by tabs, so a blank cell stays empty. The lead columns, in order, are `policy`, `seed`, `hail_id`, `phase`, `terminal`, `total`, `plans`, `checkpoints`, and `errors`. The part columns are the engine's parts, in the engine's order. When a part has a unit, the header is the key and the unit, for example `pickup (min)`.

`phase` is the engine phase. `terminal` is the report label. `arrived` is `landed`. `planning`, `in_flight`, and `abandoned` are `stranded`. Any run that does not arrive is stranded. A stranded row leaves `total` and the part columns blank.

On a 100 point score the printed parts are rounded to 0.1 after the total is rounded, so they need not sum to the total. On a score whose `out_of` is not 100, or whose parts carry units, the total is the sum of the part scores.

`--skill` is `weak`, `mid`, `strong`, or `top`. The default is `top`. Each tier is a simulated assumption, not a measured model error rate. `weak` uses noise 0.5 and look depth 0. `mid` uses noise 0.25 and look depth 1. `strong` uses noise 0.1 and look depth 2. `top` uses noise 0 and look depth 3. `--noise` replaces that tier's noise with a number from 0 to 1 and leaves the look depth. Look depth is how many forecasts from the start of the policy's list are read. Noise is the chance that a plan choice, a launch answer, or a pad answer is replaced with the other answer. Noise 0 does not draw those chances, so a top run matches a run that omits both flags.

The skill line is `Skills: tier <tier>, noise <noise>, look depth <depth>. Simulated assumptions, not real model benchmark numbers.`

Mean lines sit under the table. A mean uses landed rides only. Stranded rides are counted beside it and are not folded in as 0. Each mean line is `<policy> landed mean <two decimals> over <landed> landed, <stranded> stranded`. When no ride lands, the mean is `none`. When the careful landed mean is below the naive landed mean, the next line is `Finding: careful landed mean X is below naive landed mean Y.`
