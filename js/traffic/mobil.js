export const MOBIL_DEFAULT = { politeness: 0.25, threshold: 0.3, safeDecel: 3.0 };
export function mobilDecision(inp, p) {
    const incentive = (inp.myNewAccel - inp.myAccel) +
        p.politeness * ((inp.newFollowerNewAccel - inp.newFollowerAccel) + (inp.oldFollowerNewAccel - inp.oldFollowerAccel));
    const safe = inp.newFollowerNewAccel >= -p.safeDecel;
    return { change: safe && incentive > p.threshold, incentive };
}
