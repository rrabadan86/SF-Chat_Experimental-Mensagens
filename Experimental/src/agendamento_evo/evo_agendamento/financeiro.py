# -*- coding: utf-8 -*-
"""
Dados financeiros por aluna, para o TKM (ticket médio) da grade.

Dois indicadores, porque significam coisas diferentes:

1) TICKET MENSAL DO CONTRATO — valor "de tabela" que a aluna paga por mês.
   Fonte: a VENDA do contrato vigente (/api/v1/sales → saleItens → saleValue,
   casada pelo idMemberMembership da matrícula ativa), dividida pelo nº de meses
   de duração do contrato (datas de início/fim da matrícula ativa). Assim um anual
   de R$7.320 vira ~R$610/mês e fica comparável com um mensal. Funciona inclusive
   para contratos CUSTOMIZADOS (C.C.), que não existem no catálogo de planos.

2) FATURAMENTO DO MÊS (vencimento) — o quanto está previsto receber no mês.
   Fonte: os RECEBÍVEIS com vencimento no mês corrente (/api/v1/receivables,
   filtro memberId/dueDate), somando `ammount` e ignorando os cancelados. É o
   dinheiro do mês (oscila: pagamento anual à vista, boletos, etc.).

Best-effort: uma falha numa aluna (ou no bloco de recebíveis) nunca derruba a
grade — o indicador só fica em branco (None). Custo no EVO: ~2 chamadas por aluna
(detalhe + venda) + algumas páginas de recebíveis do mês (em bloco, não por aluna).
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


def _faturamento_do_mes(evo, now, ids, branch_id=None):
    """Recebíveis com VENCIMENTO no mês corrente, somados por aluna (idMemberPayer).
    Ignora cancelados. Busca em BLOCO (filtro de período), não por aluna."""
    out = {}
    hoje = now.date()
    ini = hoje.replace(day=1)
    fim = _fim_do_mes(hoje)
    take, skip = 100, 0
    for _ in range(80):                                # teto de páginas (segurança)
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
            pid = r.get("idMemberPayer")
            if pid not in ids:
                continue
            nome_status = str((r.get("status") or {}).get("name") or "").lower()
            if "cancel" in nome_status:                # cancelado não conta
                continue
            val = r.get("ammount")
            if val is None:
                val = r.get("ammountPaid")
            if val is None:
                continue
            try:
                out[pid] = round(out.get(pid, 0.0) + float(val), 2)
            except (TypeError, ValueError):
                pass
        if len(rows) < take:
            break
        skip += take
    return out


def carregar_financeiro(evo, idmembers, now, branch_id=None):
    """Para cada aluna (idMember), devolve
        {idm: {"ticket": <mensal do contrato>|None,
               "fatura": <a receber no mês>|None,
               "plano": <nome do contrato vigente>|None}}
    Best-effort — nunca levanta exceção."""
    ids = {int(i) for i in idmembers if i}
    if not ids:
        return {}
    # Faturamento do mês em bloco (uma varredura, não por aluna).
    fatura = _faturamento_do_mes(evo, now, ids, branch_id)
    out = {}
    for idm in ids:
        info = {"ticket": None, "fatura": fatura.get(idm), "plano": None}
        try:
            det = evo._request("GET", f"/api/v1/members/{int(idm)}") or {}
            mb = det.get("membership") or {}           # matrícula ATIVA
            info["plano"] = (mb.get("name") or "").strip() or None
            imm = mb.get("idMemberMembership")
            meses = _meses_contrato(mb.get("startDate"), mb.get("endDate"))
            if imm and meses:
                val = _valor_contrato(evo, idm, imm, branch_id)
                if val is not None:
                    info["ticket"] = round(val / meses, 2)
        except Exception as e:
            log.warning("financeiro: aluna %s falhou (%s)", idm, e)
        out[idm] = info
    return out


def resumir(fin):
    """Agrega o dicionário de carregar_financeiro em totais/médias."""
    tickets = [v["ticket"] for v in fin.values() if v.get("ticket")]
    faturas = [v["fatura"] for v in fin.values() if v.get("fatura")]
    return {
        "tkm_medio": round(sum(tickets) / len(tickets), 2) if tickets else None,
        "tkm_alunas": len(tickets),
        "tkm_total": round(sum(tickets), 2) if tickets else None,
        "fatura_mes": round(sum(faturas), 2) if faturas else None,
        "fatura_alunas": len(faturas),
    }
