#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
전체사원관리 엑셀(.xlsx) -> 업체관리 초기데이터(seed.json / seed.csv) 빌더

분류 규칙(요구사항 기준)
------------------------------------------------------------------
소속(E열) 앞 기호로 업체구분 판정
  ■ ■■ □ □□            -> 판매점
  ★ ★★ ☆ ☆☆            -> 협력점
  ◆ ◆◆ ◇ ◇◇            -> 협력점 (별도 인센티브)
  숫자 접두 0.~9. 등       -> 자점
  앞머리 ● (우주커넥트/케이티텔레캅 충북지사/패스앤슈팅) -> 자점
사원명(B열) 괄호 마커로 전달여부 판정 (협력점/인센티브에 적용)
  (O)(○)(o) -> 전달  / (X)(x) -> 미전달(직접 웹처리) / (?) -> 보류

전달 기본값(수정 가능)
  판매점  : 웹활용 N, 카카오톡채널,  접수대행/유선접수/유선개통/무선개통/회신 = 모두 Y
  협력점(O): 웹활용 N, 카카오톡단체방, 접수대행/유선접수/유선개통/회신 = Y, 무선개통 = Y
  협력점(X): 웹활용 Y, 카카오톡단체방, 접수대행/유선접수/유선개통/회신 = N, 무선개통 = Y(항상)
  협력점(?): 보류 상태, 무선개통 = Y, 나머지 미정
  자점     : 웹활용 Y, 어드민,        전달 전체 N
※ 무선개통전달은 O/X와 무관하게 판매점·협력점 모두 Y (요구사항 11)
"""
import openpyxl, re, json, csv, sys, os
from collections import defaultdict

SRC = sys.argv[1] if len(sys.argv) > 1 else \
    "/root/.claude/uploads/360778eb-9428-5eb9-9470-8efa3f918742/63159a74-______202608131041.xlsx"
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "data")

SALES_SYMS   = ["■■", "□□", "■", "□"]                 # 판매점 (긴 것 먼저)
PARTNER_SYMS = ["★★", "☆☆", "◆◆", "◇◇", "★", "☆", "◆", "◇"]  # 협력점
INCENTIVE_SYMS = ["◆◆", "◇◇", "◆", "◇"]              # 인센티브 협력점
ALL_SYMS = "■□★☆◆◇●○◎"


def clean(s):
    if s is None:
        return ""
    return str(s).replace("\xa0", " ").strip()


def lead_symbol(soan):
    """소속 앞 기호 추출 (■■/★★/●/숫자 등)."""
    s = soan
    if s.startswith("●"):
        return "●"
    m = re.match(r"^(\d+)\.", s)
    if m:
        return m.group(0)            # 예: '0.'
    for sym in SALES_SYMS + PARTNER_SYMS:
        if s.startswith(sym):
            return sym
    return ""


def classify(soan):
    s = soan
    if s.startswith("●"):
        return "자점"
    if re.match(r"^\d+\.", s):
        return "자점"
    for sym in SALES_SYMS:
        if s.startswith(sym):
            return "판매점"
    for sym in PARTNER_SYMS:
        if s.startswith(sym):
            return "협력점"
    return "미분류"


def is_incentive(soan):
    for sym in INCENTIVE_SYMS:
        if soan.startswith(sym):
            return True
    return False


def company_name(soan):
    """앞 기호/숫자접두, 뒤 ● 제거해 순수 업체명 추출(괄호 부가정보는 유지)."""
    s = soan
    s = re.sub(r"^\d+\.", "", s)               # 숫자 접두 제거
    s = s.lstrip(ALL_SYMS).strip()             # 앞쪽 기호 제거
    s = s.rstrip(ALL_SYMS).strip()             # 뒤쪽 ● 등 제거
    return s.strip()


MARKER_MAP = {"o": "O", "O": "O", "○": "O", "Ｏ": "O",
              "x": "X", "X": "X", "×": "X",
              "?": "?", "？": "?"}


def marker_of(name):
    m = re.search(r"[\(\（]\s*([oOxX○Ｏ×？?])\s*[\)\）]", name)
    if not m:
        return None
    return MARKER_MAP.get(m.group(1))


def pick_marker(markers):
    """계정들 마커 중 대표값. 우선순위 O/X > ? > 없음. O·X 충돌시 X(보수적)."""
    s = [m for m in markers if m]
    if not s:
        return ""
    if "O" in s and "X" in s:
        return "X"
    if "X" in s:
        return "X"
    if "O" in s:
        return "O"
    if "?" in s:
        return "?"
    return ""


def derive(gubun, incentive, marker):
    """구분·마커로 전달 기본값 도출."""
    d = dict(웹활용="", 소통채널="", 접수대행="", 유선접수전달="",
             유선개통전달="", 무선개통전달="", 회신전달="", 직접접수="", 상태="활성")
    if gubun == "판매점":
        d.update(웹활용="N", 소통채널="카카오톡채널", 접수대행="Y", 유선접수전달="Y",
                 유선개통전달="Y", 무선개통전달="Y", 회신전달="Y", 직접접수="N")
        if marker == "O":       # 일부 판매점은 웹 활용
            d["웹활용"] = "Y"
    elif gubun == "협력점":
        d["소통채널"] = "카카오톡단체방"
        d["무선개통전달"] = "Y"          # 항상 전달
        if marker == "O":
            d.update(웹활용="N", 접수대행="Y", 유선접수전달="Y", 유선개통전달="Y", 회신전달="Y")
        elif marker == "X":
            d.update(웹활용="Y", 접수대행="N", 유선접수전달="N", 유선개통전달="N", 회신전달="N")
        elif marker == "?":
            d.update(웹활용="", 접수대행="", 유선접수전달="", 유선개통전달="", 회신전달="", 상태="보류")
        else:                    # 무기호(마커없음) 협력점 -> 보류 대상
            d.update(웹활용="", 접수대행="", 유선접수전달="", 유선개통전달="", 회신전달="", 상태="보류")
    elif gubun == "자점":
        d.update(웹활용="Y", 소통채널="어드민", 접수대행="N", 유선접수전달="N",
                 유선개통전달="N", 무선개통전달="N", 회신전달="N", 직접접수="N")
    return d


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb.active
    groups = defaultdict(lambda: {"accounts": [], "markers": []})
    for r in range(2, ws.max_row + 1):
        name = clean(ws.cell(row=r, column=2).value)
        soan = clean(ws.cell(row=r, column=5).value)
        uid = clean(ws.cell(row=r, column=4).value)
        tel = clean(ws.cell(row=r, column=8).value)
        no = ws.cell(row=r, column=1).value
        if not name and not soan:
            continue
        g = groups[soan]
        g["accounts"].append({"no": no, "사원명": name, "아이디": uid, "연락처": tel})
        g["markers"].append(marker_of(name))

    companies = []
    for idx, (soan, g) in enumerate(sorted(groups.items()), start=1):
        gubun = classify(soan)
        inc = is_incentive(soan)
        marker = pick_marker(g["markers"])
        d = derive(gubun, inc, marker)
        rep = next((a for a in g["accounts"] if a["연락처"] and a["연락처"] not in ("-", "")), g["accounts"][0])
        companies.append({
            "id": idx,
            "소속원문": soan,
            "업체명": company_name(soan),
            "기호": lead_symbol(soan),
            "업체구분": gubun,
            "인센티브": "Y" if inc else "N",
            "전달마커": marker,
            "소통채널": d["소통채널"],
            "웹활용": d["웹활용"],
            "직접접수": d["직접접수"],
            "접수대행": d["접수대행"],
            "유선접수전달": d["유선접수전달"],
            "유선개통전달": d["유선개통전달"],
            "무선개통전달": d["무선개통전달"],
            "회신전달": d["회신전달"],
            "계정수": len(g["accounts"]),
            "대표아이디": rep["아이디"],
            "연락처": rep["연락처"] if rep["연락처"] not in ("-",) else "",
            "상태": d["상태"],
            "비고": "",
        })

    os.makedirs(os.path.abspath(OUT_DIR), exist_ok=True)
    jpath = os.path.join(os.path.abspath(OUT_DIR), "seed.json")
    with open(jpath, "w", encoding="utf-8") as f:
        json.dump({"generatedFrom": os.path.basename(SRC), "count": len(companies),
                   "companies": companies}, f, ensure_ascii=False, indent=1)

    cols = ["id", "소속원문", "업체명", "기호", "업체구분", "인센티브", "전달마커",
            "소통채널", "웹활용", "직접접수", "접수대행", "유선접수전달", "유선개통전달",
            "무선개통전달", "회신전달", "계정수", "대표아이디", "연락처", "상태", "비고"]
    cpath = os.path.join(os.path.abspath(OUT_DIR), "seed.csv")
    with open(cpath, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for c in companies:
            w.writerow(c)

    # 요약
    from collections import Counter
    gc = Counter(c["업체구분"] for c in companies)
    mc = Counter(c["전달마커"] or "(없음)" for c in companies if c["업체구분"] in ("협력점",))
    print(f"업체 수: {len(companies)}")
    print("구분:", dict(gc))
    print("협력점 마커:", dict(mc))
    print("보류 상태:", sum(1 for c in companies if c["상태"] == "보류"))
    print("출력:", jpath, cpath)


if __name__ == "__main__":
    main()
