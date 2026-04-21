fn main(x: Field) {
    let max: Field = 3618502788666131213697322783095070105623107215331596699973092056135872020481;
    let is_gt = x.lt(max) == false;
    let res = if is_gt { x - max } else { x };
    assert(res.lt(max));
}
