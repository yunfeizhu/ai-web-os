from app.core.agent_graph import AgentGraphRuntime, GRAPH_NODES


def test_agent_graph_runtime_exposes_explicit_multi_agent_nodes():
    for node in ("route", "delegate", "synthesize", "evaluate"):
        assert node in GRAPH_NODES

    graph = AgentGraphRuntime(request_id="graph-node-eval")

    for node in ("route", "delegate", "synthesize", "evaluate"):
        event = graph.status(node, marker=node)
        assert event["status"] == "graph_node"
        assert event["node"] == node
        assert event["marker"] == node
