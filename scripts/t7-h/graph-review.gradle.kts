// Appended only to a disposable, reviewOnly BE clone. No approvals are emitted.
tasks.named("dependencies") {
    doLast {
        val configs = (configurations.filter { it.isCanBeResolved }.map { "project" to it } +
            buildscript.configurations.filter { it.isCanBeResolved }.map { "buildscript" to it })
        val graph = configs.map { (scope, cfg) ->
            val result = cfg.incoming.resolutionResult
            val rootId = result.rootComponent.get().id
            val components = result.allComponents.mapNotNull { c ->
                c.moduleVersion?.let { m -> mapOf("gav" to m.toString(), "reason" to c.selectionReason.descriptions.map { it.description }) }
            }
            val edges = result.allDependencies.map { edge ->
                if (edge is org.gradle.api.artifacts.result.ResolvedDependencyResult) {
                    mapOf("from" to edge.from.moduleVersion?.toString(), "requested" to edge.requested.displayName,
                        "selected" to edge.selected.moduleVersion?.toString(), "direct" to (edge.from.id == rootId), "constraint" to edge.isConstraint)
                } else mapOf("unresolved" to edge.requested.displayName)
            }
            val artifacts = cfg.resolvedConfiguration.resolvedArtifacts.map { a ->
                mapOf("gav" to a.moduleVersion.id.toString(), "file" to a.file.name,
                    "sha256" to javaSecurityMessageDigest.getInstance("SHA-256").digest(a.file.readBytes()).joinToString("") { "%02x".format(it) })
            }
            mapOf("scope" to scope, "configuration" to cfg.name, "components" to components, "edges" to edges, "artifacts" to artifacts)
        }
        val json = groovy.json.JsonOutput.toJson(mapOf("approvalIssued" to false, "configurations" to graph))
        val out = javaIoByteArrayOutputStream()
        javaUtilZipGZIPOutputStream(out).use { it.write(json.toByteArray(Charsets.UTF_8)) }
        println("T7_H_GRAPH_BEGIN\n" + javaUtilBase64.getEncoder().encodeToString(out.toByteArray()) + "\nT7_H_GRAPH_END")
    }
}
