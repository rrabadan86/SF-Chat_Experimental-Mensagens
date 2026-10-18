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
    """Lista os registros de membros ATIVOS (status=1). Confirma pelo campo
    membershipStatus pra não contar inativo por engano."""
    out, take, skip = [], 100, 0
    for _ in range(40):                                # teto de páginas (segurança)
        try:
            rows = evo._request("GET", "/api/v1/members",
                               params={"status": 1, "take": take, "skip": skip}) or []
        except Exception as e:
            log.warning("financeiro: lista de ativos falhou (%s)", e)
            break
        if not isinstance(rows, list) or not rows:
            break
        for m in rows:
            if str(m.get("membershipStatus") or "").lower() == "active":
                out.append(m)
        if len(rows) < take:
            break
        skip += take
    return out


def _ativa_na_lista(lst):
    """Da lista `memberships` de uma aluna, a matrícula ATIVA mais recente."""
    if not isinstance(lst, list):
        return None
    cand = [x for x in lst
            if str(x.get("membershipStatus") or "").lower() == "active"
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
    """Soma de TODOS os recebíveis a vencer no mês corrente (não cancelados).
    Retorna (total, nº de lançamentos)."""
    hoje = now.date()
    ini, fim = hoje.replace(day=1), _fim_do_mes(hoje)
    take, skip, soma, n = 100, 0, 0.0, 0
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
                soma += float(v); n += 1
            except (TypeError, ValueError):
                pass
        if len(rows) < take:
            break
        skip += take
    return (round(soma, 2) if n else None), n


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
    for m in ativos:
        idm = m.get("idMember")
        if not idm:
            continue
        info = {"ticket": None, "plano": None}
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
        por[idm] = info

    fatura_mes, fatura_n = _faturamento_mes(evo, now, branch_id)
    tickets = [v["ticket"] for v in por.values() if v.get("ticket")]
    resumo = {
        "ativas": len(por),
        "tkm_medio": round(sum(tickets) / len(tickets), 2) if tickets else None,
        "tkm_alunas": len(tickets),
        "tkm_total": round(sum(tickets), 2) if tickets else None,
        "fatura_mes": fatura_mes,
        "fatura_n": fatura_n,
    }
    return por, resumo
