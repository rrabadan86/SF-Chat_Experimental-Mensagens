# -*- coding: utf-8 -*-
"""
Dados financeiros do studio, para o TKM (ticket médio) e o faturamento da grade.

Base de cálculo = TODAS as alunas ATIVAS do EVO (fixas + FREE), listadas por
/api/v1/members com o filtro status=1 (o único que o EVO respeita — os outros
devolvem inativas). No Bueno isso bate com as ~81 alunas da tag "0. Aluna".

Dois indicadores (coisas diferentes):

1) TKM médio — valor MENSAL "de tabela" por aluna.
   Para cada aluna ativa: o contrato VIGENTE (saleValue da venda, casado pelo
   idMemberMembership da matrícula ativa) ÷ nº de meses de duração do contrato.
   Assim um anual de R$7.320 vira ~R$610/mês e fica comparável com um mensal.
   Funciona inclusive em contrato CUSTOMIZADO (C.C.), que não está no catálogo.

2) Faturamento do mês — o quanto vence no mês corrente.
   Soma de TODOS os recebíveis com vencimento no mês (/api/v1/receivables,
   filtro dueDate), ignorando os cancelados. É o caixa previsto do studio
   (independe do TKM: quem pagou o anual à vista não tem parcela vencendo).

Best-effort: uma falha numa aluna (ou num bloco) nunca derruba a grade — o
indicador só fica em branco. Custo no EVO: 1 página de membros ativos + ~2
chamadas por aluna ativa (detalhe + venda) + algumas páginas de recebíveis.
"""
from datetime import datetime, timedelta
import logging

log = logging.getLogger(__name__)


def _parse_date(s):
    try:
        return datetime.fromisoformat(str(s)[:19]).date()
    except Exception:
        return None


def _meses_contrato(ini, fim):
    """Nº de meses de duração do contrato (>=1), pelas datas de início/fim.
    Sem datas válidas → None (não dá pra mensalizar)."""
    di, df = _parse_date(ini), _parse_date(fim)
    if not di or not df:
        return None
    dias = (df - di).days
    if dias <= 0:
        return None
    return max(1, round(dias / 30.44))        # 30.44 = média de dias/mês


def _fim_do_mes(d):
    prox = d.replace(day=28) + timedelta(days=4)      # cai sempre no mês seguinte
    return prox - timedelta(days=prox.day)


def membros_ativos(evo, branch_id=None):
    """Membros com matrícula VIGENTE: Active + Suspended (trancadas). A trancada é
    uma aluna congelada temporariamente (viagem, etc.) — continua aluna. O EVO não
    tem filtro para 'Suspended' (status=1 só traz Active), então varre todos os
    membros e fica com os dois. Cada registro ganha a flag _trancada."""
    out, take, skip = [], 100, 0
    for _ in range(60):                                # teto de páginas (segurança)
        try:
            rows = evo._request("GET", "/api/v1/members",
                               params={"take": take, "skip": skip}) or []
        except Exception as e:
            log.warning("financeiro: lista de membros falhou (%s)", e)
            break
        if not isinstance(rows, list) or not rows:
            break
        for m in rows:
            st = str(m.get("membershipStatus") or "").lower()
            if st in ("active", "suspended"):
                m["_trancada"] = (st == "suspended")
                out.append(m)
        if len(rows) < take:
            break
        skip += take
    return out


def _ativa_na_lista(lst):
    """Da lista `memberships` de uma aluna, a matrícula VIGENTE mais recente
    (ativa OU trancada/suspensa — a trancada ainda tem contrato em vigor)."""
    if not isinstance(lst, list):
        return None
    cand = [x for x in lst
            if str(x.get("membershipStatus") or "").lower() in ("active", "suspended")
            and x.get("idMemberMembership")]
    if not cand:
        return None
    cand.sort(key=lambda x: str(x.get("startDate") or ""), reverse=True)
    return cand[0]


def _membership_ativa(evo, idm, m=None, branch_id=None):
    """Matrícula ATIVA da aluna (idMemberMembership + datas): tenta o que já veio
    inline no registro da lista; se não, busca o detalhe da aluna."""
    if isinstance(m, dict):
        mb = m.get("membership")
        if isinstance(mb, dict) and mb.get("idMemberMembership") and mb.get("startDate"):
            return mb
        best = _ativa_na_lista(m.get("memberships"))
        if best:
            return best
    try:
        det = evo._request("GET", f"/api/v1/members/{int(idm)}") or {}
        mb = det.get("membership")
        if isinstance(mb, dict) and mb.get("idMemberMembership"):
            return mb
        return _ativa_na_lista(det.get("memberships"))
    except Exception as e:
        log.warning("financeiro: detalhe da aluna %s falhou (%s)", idm, e)
        return None


def _valor_contrato(evo, idm, id_member_membership, branch_id=None):
    """saleValue (líquido) do contrato vigente da aluna, casado pelo
    idMemberMembership na venda. Cai pra itemValue se saleValue vier nulo."""
    try:
        sales = evo._request("GET", "/api/v1/sales",
                             params={"idMember": int(idm), "take": 100}) or []
    except Exception as e:
        log.warning("financeiro: vendas da aluna %s falharam (%s)", idm, e)
        return None
    for s in sales:
        for it in (s.get("saleItens") or []):
            if it.get("idMemberMembership") == id_member_membership:
                v = it.get("saleValue")
                if v is None:
                    v = it.get("itemValue")
                try:
                    return float(v) if v is not None else None
                except (TypeError, ValueError):
                    return None
    return None


def _faturamento_mes(evo, now, branch_id=None):
    """TODOS os recebíveis a vencer no mês corrente (não cancelados).
    Retorna (total, nº de lançamentos, itens) — itens com aluna/valor/pago/venc."""
    hoje = now.date()
    ini, fim = hoje.replace(day=1), _fim_do_mes(hoje)
    take, skip, soma, itens = 100, 0, 0.0, []
    for _ in range(100):                               # teto de páginas (segurança)
        try:
            rows = evo._request("GET", "/api/v1/receivables",
                               params={"dueDateStart": ini.strftime("%Y-%m-%d"),
                                       "dueDateEnd": fim.strftime("%Y-%m-%d"),
                                       "take": take, "skip": skip}) or []
        except Exception as e:
            log.warning("financeiro: recebíveis do mês falharam (%s)", e)
            break
        if not isinstance(rows, list) or not rows:
            break
        for r in rows:
            if "cancel" in str((r.get("status") or {}).get("name") or "").lower():
                continue
            v = r.get("ammount")
            if v is None:
                continue
            try:
                v = float(v)
            except (TypeError, ValueError):
                continue
            pago = r.get("ammountPaid")
            try:
                pago = float(pago) if pago is not None else None
            except (TypeError, ValueError):
                pago = None
            # "pago" = só o que CAIU DE FATO (receivingDate <= hoje). Cartão
            # provisionado com recebimento futuro ainda não entrou no caixa, então
            # não conta como pago — vira "a receber" (ou "vencido" se passou o venc).
            receb = _parse_date(str(r.get("receivingDate") or "")[:10])
            recebido = bool(receb and receb <= hoje)
            if recebido:
                sit, pago_real = "pago", (round(pago, 2) if pago is not None else None)
            else:
                dd = _parse_date(str(r.get("dueDate") or "")[:10])
                sit, pago_real = ("vencido" if (dd and dd < hoje) else "a receber"), None
            soma += v
            itens.append({
                "idm": r.get("idMemberPayer"),
                "aluna": (r.get("payerName") or "—").strip(),
                "valor": round(v, 2),
                "pago": pago_real,
                "venc": str(r.get("dueDate") or "")[:10],
                "sit": sit,
            })
        if len(rows) < take:
            break
        skip += take
    return (round(soma, 2) if itens else None), len(itens), itens


def carregar_financeiro(evo, now, branch_id=None):
    """Calcula o financeiro do studio sobre TODAS as alunas ativas.
    Retorna (por_aluna, resumo):
      por_aluna = {idMember: {"ticket": <mensal>|None, "plano": <nome>|None}}
      resumo    = {ativas, tkm_medio, tkm_alunas, tkm_total, fatura_mes, fatura_n}
    Best-effort — nunca levanta exceção."""
    try:
        ativos = membros_ativos(evo, branch_id)
    except Exception as e:
        log.warning("financeiro: não consegui listar ativos (%s)", e)
        ativos = []
    por = {}
    vips = 0
    for m in ativos:
        idm = m.get("idMember")
        if not idm:
            continue
        nome = ((m.get("firstName") or "") + " " + (m.get("lastName") or "")).strip()
        info = {"nome": nome or f"id {idm}", "ticket": None, "plano": None,
                "trancada": bool(m.get("_trancada"))}
        try:
            mb = _membership_ativa(evo, idm, m, branch_id) or {}
            info["plano"] = (mb.get("name") or "").strip() or None
            imm = mb.get("idMemberMembership")
            meses = _meses_contrato(mb.get("startDate"), mb.get("endDate"))
            if imm and meses:
                val = _valor_contrato(evo, idm, imm, branch_id)
                if val is not None:
                    info["ticket"] = round(val / meses, 2)
        except Exception as e:
            log.warning("financeiro: aluna %s falhou (%s)", idm, e)
        # VIP / cortesia (plano "VIP" ou contrato R$0): não é aluna pagante —
        # fica fora da contagem de alunas E da média do TKM.
        if "vip" in (info["plano"] or "").lower() or info["ticket"] == 0:
            vips += 1
            continue
        por[idm] = info

    fatura_mes, fatura_n, fatura_itens = _faturamento_mes(evo, now, branch_id)
    # nome do contrato de cada linha = plano da matrícula ativa do pagador (quando ele
    # é uma aluna ativa); senão fica em branco.
    for it in fatura_itens:
        it["contrato"] = (por.get(it.pop("idm"), {}) or {}).get("plano") or ""
    fatura_itens.sort(key=lambda x: x.get("valor") or 0, reverse=True)

    # alunas ATIVAS sem valor de contrato (as que ficam fora da média do TKM).
    sem_contrato = sorted(
        ({"nome": v["nome"], "plano": v.get("plano") or "—", "trancada": v.get("trancada", False)}
         for v in por.values() if not v.get("ticket")),
        key=lambda x: x["nome"].lower())

    tickets = [v["ticket"] for v in por.values() if v.get("ticket")]
    resumo = {
        "ativas": len(por),
        "trancadas": sum(1 for v in por.values() if v.get("trancada")),
        "vips": vips,
        "tkm_medio": round(sum(tickets) / len(tickets), 2) if tickets else None,
        "tkm_alunas": len(tickets),
        "tkm_total": round(sum(tickets), 2) if tickets else None,
        "fatura_mes": fatura_mes,
        "fatura_n": fatura_n,
        "fatura_itens": fatura_itens,
        "sem_contrato": sem_contrato,
    }
    return por, resumo
