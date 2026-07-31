//
//  MindMapTabContent.swift
//  scribeai
//
//  Interactive Mind Map for visual learners
//

import SwiftUI

struct MindMapTabContent: View {
    let note: Note
    @EnvironmentObject var viewModel: NoteViewModel
    @State private var mindMap: MindMap?
    @State private var isLoading = true
    @State private var isGenerating = false
    @State private var errorMessage: String?
    @State private var showPaywall = false
    @State private var selectedNode: MindMapNode?
    @State private var selectedNodeParent: MindMapNode?
    @State private var selectedExploratoryNode: MindMapNode?
    @State private var expandedNodes: Set<String> = []
    @State private var includeExploration: Bool = true
    @State private var createdNote: Note?
    @State private var showCreatedNote: Bool = false

    // Get exploratory nodes for "Explore Further" section
    private var exploratoryNodes: [MindMapNode] {
        guard let nodes = mindMap?.nodes else { return [] }
        return nodes.filter { $0.isExploratory == true }
    }

    var body: some View {
        VStack(spacing: 0) {
            if isLoading {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                    .scaleEffect(1.5)
                    .frame(maxHeight: .infinity)
            } else if isGenerating {
                VStack(spacing: 16) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                        .scaleEffect(1.5)

                    Text("Creating your mind map...")
                        .font(.system(size: 16))
                        .foregroundColor(.textSecondary)

                    Text("Analyzing content and building connections")
                        .font(.system(size: 13))
                        .foregroundColor(.textTertiary)
                }
                .frame(maxHeight: .infinity)
            } else if let mindMap = mindMap, !mindMap.nodes.isEmpty {
                // Mind Map View
                ScrollView {
                    VStack(spacing: 16) {
                        // Header
                        HStack {
                            Text(mindMap.title)
                                .font(.system(size: 18, weight: .bold))
                                .foregroundColor(.textPrimary)

                            Spacer()

                            Button(action: {
                                self.mindMap = nil
                                generateMindMap()
                            }) {
                                HStack(spacing: 4) {
                                    Image(systemName: "arrow.clockwise")
                                        .font(.system(size: 12))
                                    Text("Regenerate")
                                        .font(.system(size: 13, weight: .medium))
                                }
                                .foregroundColor(.purple80)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 12)

                        // Simple 2-level Mind Map Tree
                        SimpleMindMapTree(
                            nodes: mindMap.nodes,
                            expandedNodes: $expandedNodes,
                            onNodeSelected: { node, parent in
                                selectedNode = node
                                selectedNodeParent = parent
                            }
                        )

                        // Explore Further Section (if there are exploratory nodes)
                        if !exploratoryNodes.isEmpty {
                            ExploreFurtherSection(
                                nodes: exploratoryNodes,
                                onNodeTap: { node in
                                    selectedExploratoryNode = node
                                }
                            )
                        }

                        Spacer().frame(height: 20)
                    }
                }
            } else {
                // Generate Mind Map UI
                ScrollView {
                    VStack(spacing: 24) {
                        // Header
                        VStack(spacing: 12) {
                            ZStack {
                                Circle()
                                    .fill(Color.purple80.opacity(0.2))
                                    .frame(width: 100, height: 100)

                                Image(systemName: "brain.head.profile")
                                    .font(.system(size: 50))
                                    .foregroundColor(.purple80)
                            }

                            Text("Generate Mind Map")
                                .font(.system(size: 22, weight: .bold))
                                .foregroundColor(.textPrimary)

                            Text("Visualize concepts and their connections")
                                .font(.system(size: 14))
                                .foregroundColor(.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.top, 40)

                        // Options
                        VStack(alignment: .leading, spacing: 16) {
                            Toggle(isOn: $includeExploration) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Include Exploration")
                                        .font(.system(size: 15, weight: .medium))
                                        .foregroundColor(.textPrimary)
                                    Text("Add suggested topics to deepen understanding")
                                        .font(.system(size: 12))
                                        .foregroundColor(.textSecondary)
                                }
                            }
                            .toggleStyle(SwitchToggleStyle(tint: .purple80))
                        }
                        .padding(16)
                        .background(Color.cardBackground)
                        .cornerRadius(12)
                        .padding(.horizontal, 20)

                        // Features list
                        VStack(alignment: .leading, spacing: 12) {
                            MindMapFeatureRow(icon: "arrow.triangle.branch", text: "Visual hierarchy of concepts")
                            MindMapFeatureRow(icon: "hand.tap", text: "Tap nodes to see details")
                            MindMapFeatureRow(icon: "sparkles", text: "AI-suggested topics to explore")
                            MindMapFeatureRow(icon: "paintpalette", text: "Color-coded branches")
                        }
                        .padding(.horizontal, 20)

                        if let error = errorMessage {
                            Text(error)
                                .font(.system(size: 13))
                                .foregroundColor(.accentRed)
                                .padding()
                                .background(Color.accentRed.opacity(0.1))
                                .cornerRadius(8)
                                .padding(.horizontal, 20)
                        }

                        // Generate Button
                        Button(action: { generateMindMap() }) {
                            HStack {
                                Image(systemName: "sparkles")
                                Text("Generate Mind Map")
                                    .font(.system(size: 16, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(Color.purple80)
                            .foregroundColor(.white)
                            .cornerRadius(28)
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 32)
                    }
                }
            }
        }
        .onAppear {
            AnalyticsService.shared.trackMindMapTabViewed(noteId: note.id)
            loadMindMap()
        }
        .sheet(isPresented: $showPaywall) {
            NavigationView {
                ScribeRemotePaywallView(triggerSource: "mindmap_feature_gate") {
                    showPaywall = false
                    Task {
                        await SubscriptionGateManager.shared.refreshAccessStatus()
                    }
                }
            }
        }
        .sheet(item: $selectedNode) { node in
            NodeDetailSheet(
                node: node,
                parentNode: selectedNodeParent,
                noteId: note.id,
                noteContent: note.content,
                onDismiss: {
                    selectedNode = nil
                    selectedNodeParent = nil
                }
            )
        }
        .sheet(item: $selectedExploratoryNode) { node in
            ExploratoryResourcesSheet(
                topic: node.label,
                topicDescription: node.content,
                noteId: note.id,
                noteContent: note.content,
                viewModel: viewModel,
                onDismiss: { selectedExploratoryNode = nil },
                onNoteCreated: { newNote in
                    selectedExploratoryNode = nil
                    createdNote = newNote
                    showCreatedNote = true
                }
            )
        }
        .fullScreenCover(isPresented: $showCreatedNote) {
            if let newNote = createdNote {
                NavigationView {
                    NoteDetailTabView(note: newNote, viewModel: viewModel)
                }
                .environmentObject(viewModel)
            }
        }
    }

    private func loadMindMap() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            print("No auth token found")
            isLoading = false
            return
        }

        Task {
            do {
                let aiContent = try await APIService.shared.getAIContent(token: token, noteId: note.id, contentType: "mindmap")
                await MainActor.run {
                    if let title = aiContent?.mindMapTitle, let nodes = aiContent?.mindMapNodes, !nodes.isEmpty {
                        self.mindMap = MindMap(
                            id: aiContent?.id ?? UUID().uuidString,
                            noteId: note.id,
                            title: title,
                            nodes: nodes,
                            createdAt: aiContent?.createdAt ?? ISO8601DateFormatter().string(from: Date())
                        )
                        // Expand top-level nodes by default
                        self.expandedNodes = Set(nodes.filter { $0.level == 0 }.map { $0.id })
                    }
                    self.isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.isLoading = false
                    print("Error loading mind map: \(error)")
                }
            }
        }
    }

    private func generateMindMap() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            errorMessage = "Not authenticated"
            return
        }

        AnalyticsService.shared.trackMindMapGenerateStarted(noteId: note.id)
        isGenerating = true
        errorMessage = nil

        Task {
            do {
                let aiContent = try await APIService.shared.generateMindMap(
                    token: token,
                    noteId: note.id,
                    noteContent: note.content,
                    contentLength: note.content.count,
                    includeExploration: includeExploration
                )
                await MainActor.run {
                    if let title = aiContent.mindMapTitle, let nodes = aiContent.mindMapNodes {
                        self.mindMap = MindMap(
                            id: aiContent.id ?? UUID().uuidString,
                            noteId: note.id,
                            title: title,
                            nodes: nodes,
                            createdAt: aiContent.createdAt ?? ISO8601DateFormatter().string(from: Date())
                        )
                        self.expandedNodes = Set(nodes.filter { $0.level == 0 }.map { $0.id })
                        AnalyticsService.shared.trackMindMapGenerated(noteId: note.id, nodeCount: nodes.count)
                    }
                    self.isGenerating = false
                }
            } catch let error as APIError {
                print("❌ Mind Map APIError: \(error)")
                await MainActor.run {
                    self.isGenerating = false
                    switch error {
                    case .subscriptionRequired, .freeTierLimitReached:
                        self.showPaywall = true
                    case .decodingError:
                        self.errorMessage = "Failed to process mind map data. Please try again."
                    default:
                        self.errorMessage = error.localizedDescription
                    }
                }
            } catch {
                print("❌ Mind Map generation error: \(error)")
                await MainActor.run {
                    self.errorMessage = "Failed to generate mind map: \(error.localizedDescription)"
                    self.isGenerating = false
                }
            }
        }
    }
}

// MARK: - Simple 2-Level Mind Map Tree

struct SimpleMindMapTree: View {
    let nodes: [MindMapNode]
    @Binding var expandedNodes: Set<String>
    let onNodeSelected: (MindMapNode, MindMapNode?) -> Void

    // Get level 0 nodes (main branches) - exclude exploratory
    private var mainBranches: [MindMapNode] {
        nodes.filter { $0.level == 0 && $0.isExploratory != true }
    }

    var body: some View {
        VStack(spacing: 12) {
            ForEach(mainBranches) { branch in
                BranchCard(
                    branch: branch,
                    children: nodes.filter { $0.parentId == branch.id && $0.isExploratory != true },
                    isExpanded: expandedNodes.contains(branch.id),
                    onToggle: {
                        withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) {
                            if expandedNodes.contains(branch.id) {
                                expandedNodes.remove(branch.id)
                            } else {
                                expandedNodes.insert(branch.id)
                            }
                        }
                    },
                    onBranchTap: {
                        // Parent node tapped - no parent context
                        onNodeSelected(branch, nil)
                    },
                    onChildTap: { child in
                        // Child node tapped - pass branch as parent
                        onNodeSelected(child, branch)
                    }
                )
            }
        }
        .padding(.horizontal, 16)
    }
}

// MARK: - Branch Card (Main topic with expandable children)

struct BranchCard: View {
    let branch: MindMapNode
    let children: [MindMapNode]
    let isExpanded: Bool
    let onToggle: () -> Void
    let onBranchTap: () -> Void
    let onChildTap: (MindMapNode) -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Main branch header
            HStack(spacing: 12) {
                // Color bar
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color(hex: branch.color ?? "#BB86FC"))
                    .frame(width: 6)

                // Tappable content area - triggers AI query
                Button(action: onBranchTap) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(branch.label)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.textPrimary)
                            .multilineTextAlignment(.leading)

                        Text(branch.content)
                            .font(.system(size: 13))
                            .foregroundColor(.textSecondary)
                            .lineLimit(isExpanded ? nil : 2)
                            .multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(PlainButtonStyle())

                // Expand/collapse button
                if !children.isEmpty {
                    Button(action: onToggle) {
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.textSecondary)
                            .frame(width: 32, height: 32)
                    }
                    .buttonStyle(PlainButtonStyle())
                }
            }
            .padding(16)

            // Children (level 1)
            if isExpanded && !children.isEmpty {
                VStack(spacing: 0) {
                    ForEach(children) { child in
                        ChildNodeRow(
                            node: child,
                            parentColor: branch.color ?? "#BB86FC",
                            onTap: { onChildTap(child) }
                        )
                    }
                }
                .padding(.leading, 22)
                .padding(.bottom, 12)
            }
        }
        .background(Color.cardBackground)
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color(hex: branch.color ?? "#BB86FC").opacity(0.3), lineWidth: 1)
        )
    }
}

// MARK: - Child Node Row

struct ChildNodeRow: View {
    let node: MindMapNode
    let parentColor: String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                // Connection line indicator
                HStack(spacing: 0) {
                    Rectangle()
                        .fill(Color(hex: parentColor).opacity(0.3))
                        .frame(width: 2, height: 40)
                    Rectangle()
                        .fill(Color(hex: parentColor).opacity(0.3))
                        .frame(width: 12, height: 2)
                }

                // Bullet
                Circle()
                    .fill(Color(hex: parentColor).opacity(0.6))
                    .frame(width: 8, height: 8)

                // Content
                VStack(alignment: .leading, spacing: 2) {
                    Text(node.label)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.textPrimary)

                    Text(node.content)
                        .font(.system(size: 12))
                        .foregroundColor(.textSecondary)
                        .lineLimit(2)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 12))
                    .foregroundColor(.textTertiary)
            }
            .padding(.trailing, 16)
            .padding(.vertical, 6)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - Explore Further Section

struct ExploreFurtherSection: View {
    let nodes: [MindMapNode]
    let onNodeTap: (MindMapNode) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Section Header
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 16))
                    .foregroundColor(.accentGreen)

                Text("Explore Further")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.textPrimary)

                Spacer()
            }
            .padding(.horizontal, 16)

            Text("Tap a topic to discover learning resources")
                .font(.system(size: 13))
                .foregroundColor(.textSecondary)
                .padding(.horizontal, 16)

            // Exploratory nodes as cards
            VStack(spacing: 10) {
                ForEach(nodes) { node in
                    ExploratoryTopicCard(node: node, onTap: { onNodeTap(node) })
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.top, 16)
    }
}

// MARK: - Exploratory Topic Card

struct ExploratoryTopicCard: View {
    let node: MindMapNode
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(node.label)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.textPrimary)

                    Spacer()

                    HStack(spacing: 4) {
                        Image(systemName: "book.fill")
                            .font(.system(size: 12))
                        Text("Resources")
                            .font(.system(size: 11, weight: .medium))
                    }
                    .foregroundColor(.accentGreen)
                }

                Text(node.content)
                    .font(.system(size: 13))
                    .foregroundColor(.textSecondary)
                    .lineSpacing(2)
                    .multilineTextAlignment(.leading)
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.accentGreen.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(Color.accentGreen.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    )
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - Node Detail Sheet (with AI Chat Query)

struct NodeDetailSheet: View {
    let node: MindMapNode
    let parentNode: MindMapNode?
    let noteId: String
    let noteContent: String
    let onDismiss: () -> Void

    @State private var aiResponse: String = ""
    @State private var isLoading: Bool = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Node color bar
                    Rectangle()
                        .fill(Color(hex: node.color ?? "#BB86FC"))
                        .frame(height: 4)
                        .cornerRadius(2)

                    // Title
                    HStack {
                        Text(node.label)
                            .font(.system(size: 22, weight: .bold))
                            .foregroundColor(.textPrimary)

                        Spacer()

                        if node.isExploratory == true {
                            HStack(spacing: 4) {
                                Image(systemName: "sparkles")
                                Text("Explore")
                            }
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.accentGreen)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.accentGreen.opacity(0.2))
                            .cornerRadius(12)
                        }
                    }

                    // Context indicator
                    if let parent = parentNode {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.turn.down.right")
                                .font(.system(size: 12))
                            Text("In context of: \(parent.label)")
                                .font(.system(size: 13))
                        }
                        .foregroundColor(.textTertiary)
                    }

                    Divider()
                        .background(Color.darkSurfaceVariant)

                    // AI Response Section
                    if isLoading {
                        VStack(spacing: 12) {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .purple80))

                            Text("Analyzing sources...")
                                .font(.system(size: 14))
                                .foregroundColor(.textSecondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                    } else if let error = errorMessage {
                        VStack(spacing: 12) {
                            Image(systemName: "exclamationmark.triangle")
                                .font(.system(size: 24))
                                .foregroundColor(.accentRed)

                            Text(error)
                                .font(.system(size: 14))
                                .foregroundColor(.textSecondary)
                                .multilineTextAlignment(.center)

                            Button("Try Again") {
                                fetchAIResponse()
                            }
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.purple80)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                    } else {
                        // AI Response
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 6) {
                                Image(systemName: "text.bubble")
                                    .font(.system(size: 14))
                                Text("From your notes")
                                    .font(.system(size: 13, weight: .medium))
                            }
                            .foregroundColor(.purple80)

                            Text(aiResponse)
                                .font(.system(size: 15))
                                .foregroundColor(.textPrimary)
                                .lineSpacing(5)
                        }
                    }

                    Spacer()
                }
                .padding(20)
            }
            .background(Color.darkBackground)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { onDismiss() }
                        .foregroundColor(.purple80)
                }
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            fetchAIResponse()
        }
    }

    private func fetchAIResponse() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            errorMessage = "Not authenticated"
            isLoading = false
            return
        }

        isLoading = true
        errorMessage = nil

        // Build the question based on context
        let question: String
        if let parent = parentNode {
            question = "What do the sources say about \"\(node.label)\" in the context of \"\(parent.label)\"? Please provide a focused, detailed explanation."
        } else {
            question = "What do the sources say about \"\(node.label)\"? Please provide a focused, detailed explanation."
        }

        Task {
            do {
                let response = try await APIService.shared.chatWithNote(
                    token: token,
                    noteId: noteId,
                    noteContent: noteContent,
                    question: question,
                    conversationHistory: []
                )
                await MainActor.run {
                    self.aiResponse = response.answer
                    self.isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = "Failed to get response. Please try again."
                    self.isLoading = false
                }
            }
        }
    }
}

// MARK: - Exploratory Resources Sheet

struct LearningResource: Identifiable {
    let id = UUID()
    let title: String
    let type: String  // "Book", "Article", "Video", "Course"
    let description: String

    var icon: String {
        switch type.lowercased() {
        case "book": return "book.fill"
        case "article": return "doc.text.fill"
        case "video": return "play.rectangle.fill"
        case "course": return "graduationcap.fill"
        default: return "link"
        }
    }
}

struct ExploratoryResourcesSheet: View {
    let topic: String
    let topicDescription: String
    let noteId: String
    let noteContent: String
    let viewModel: NoteViewModel
    let onDismiss: () -> Void
    let onNoteCreated: (Note) -> Void
    @State private var resources: [LearningResource] = []
    @State private var isLoading: Bool = true
    @State private var errorMessage: String?
    @State private var isCreatingNote: Bool = false
    @State private var selectedResource: LearningResource?

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Topic Header
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: "lightbulb.fill")
                                .font(.system(size: 20))
                                .foregroundColor(.accentGreen)

                            Text("Explore Topic")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.accentGreen)
                        }

                        Text(topic)
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.textPrimary)

                        Text(topicDescription)
                            .font(.system(size: 14))
                            .foregroundColor(.textSecondary)
                            .lineSpacing(3)
                    }
                    .padding(.bottom, 8)

                    Divider()
                        .background(Color.darkSurfaceVariant)

                    // Resources Section
                    if isLoading {
                        VStack(spacing: 16) {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .purple80))

                            Text("Finding learning resources...")
                                .font(.system(size: 14))
                                .foregroundColor(.textSecondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    } else if let error = errorMessage {
                        VStack(spacing: 12) {
                            Image(systemName: "exclamationmark.triangle")
                                .font(.system(size: 28))
                                .foregroundColor(.accentRed)

                            Text(error)
                                .font(.system(size: 14))
                                .foregroundColor(.textSecondary)
                                .multilineTextAlignment(.center)

                            Button("Try Again") {
                                fetchResources()
                            }
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.purple80)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Suggested Resources")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(.textPrimary)

                            Text("Tap a resource to create a note from it")
                                .font(.system(size: 13))
                                .foregroundColor(.textSecondary)

                            VStack(spacing: 12) {
                                ForEach(resources) { resource in
                                    ResourceCard(
                                        resource: resource,
                                        isCreating: isCreatingNote && selectedResource?.id == resource.id,
                                        onTap: {
                                            createNoteFromResource(resource)
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
            .background(Color.darkBackground)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { onDismiss() }
                        .foregroundColor(.purple80)
                }
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            fetchResources()
        }
    }

    private func fetchResources() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            errorMessage = "Not authenticated"
            isLoading = false
            return
        }

        isLoading = true
        errorMessage = nil

        let question = """
        I want to learn more about "\(topic)". Please suggest exactly 3 learning resources in this exact JSON format:
        [
          {"title": "Resource Name", "type": "Book|Article|Video|Course", "description": "Brief description of why this resource is helpful"}
        ]
        Only respond with the JSON array, no other text.
        """

        Task {
            do {
                let response = try await APIService.shared.chatWithNote(
                    token: token,
                    noteId: noteId,
                    noteContent: noteContent,
                    question: question,
                    conversationHistory: []
                )

                await MainActor.run {
                    // Parse the JSON response
                    if let data = response.answer.data(using: .utf8) {
                        do {
                            if let jsonArray = try JSONSerialization.jsonObject(with: data) as? [[String: String]] {
                                self.resources = jsonArray.compactMap { dict in
                                    guard let title = dict["title"],
                                          let type = dict["type"],
                                          let description = dict["description"] else { return nil }
                                    return LearningResource(title: title, type: type, description: description)
                                }
                            }
                        } catch {
                            // Fallback: try to extract from response text
                            self.parseResourcesFromText(response.answer)
                        }
                    } else {
                        self.parseResourcesFromText(response.answer)
                    }

                    if self.resources.isEmpty {
                        self.errorMessage = "Couldn't find resources. Please try again."
                    }
                    self.isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = "Failed to fetch resources. Please try again."
                    self.isLoading = false
                }
            }
        }
    }

    private func parseResourcesFromText(_ text: String) {
        // Fallback parser for non-JSON responses
        // Extract resource suggestions from natural text
        let lines = text.components(separatedBy: "\n").filter { !$0.isEmpty }
        var parsedResources: [LearningResource] = []

        for line in lines.prefix(3) {
            let cleanLine = line.trimmingCharacters(in: .whitespaces)
            if cleanLine.count > 5 {
                // Try to determine type from keywords
                var type = "Article"
                if cleanLine.lowercased().contains("book") { type = "Book" }
                else if cleanLine.lowercased().contains("video") || cleanLine.lowercased().contains("youtube") { type = "Video" }
                else if cleanLine.lowercased().contains("course") { type = "Course" }

                parsedResources.append(LearningResource(
                    title: cleanLine.prefix(100).description,
                    type: type,
                    description: "Suggested resource for learning about \(topic)"
                ))
            }
        }

        self.resources = parsedResources
    }

    private func createNoteFromResource(_ resource: LearningResource) {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else { return }

        selectedResource = resource
        isCreatingNote = true

        Task {
            do {
                // First, generate content about this resource/topic
                let contentQuestion = """
                Create comprehensive study notes about "\(resource.title)" in the context of learning about "\(topic)".
                Include:
                - Key concepts and definitions
                - Main ideas and takeaways
                - Practical applications
                Format it as well-structured study notes with clear headings.
                """

                let contentResponse = try await APIService.shared.chatWithNote(
                    token: token,
                    noteId: noteId,
                    noteContent: noteContent,
                    question: contentQuestion,
                    conversationHistory: []
                )

                print("✅ Got content for new note, creating note...")

                // Create the new note
                let newNote = try await APIService.shared.createNote(
                    token: token,
                    title: "\(topic): \(resource.title)",
                    content: contentResponse.answer,
                    sourceType: "tutorial",
                    sourceUrl: nil,
                    metadata: [
                        "derived_from": noteId,
                        "resource_type": resource.type,
                        "original_topic": topic
                    ]
                )

                await MainActor.run {
                    self.isCreatingNote = false
                    Task {
                        await self.viewModel.loadNotes(token: token)
                    }
                    self.onNoteCreated(newNote)
                }
            } catch {
                print("❌ Failed to create note from resource: \(error)")
                await MainActor.run {
                    self.isCreatingNote = false
                    self.errorMessage = "Failed to create note. Please try again."
                }
            }
        }
    }
}

// MARK: - Resource Card

struct ResourceCard: View {
    let resource: LearningResource
    let isCreating: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 14) {
                // Icon
                ZStack {
                    Circle()
                        .fill(Color.purple80.opacity(0.2))
                        .frame(width: 44, height: 44)

                    if isCreating {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                            .scaleEffect(0.8)
                    } else {
                        Image(systemName: resource.icon)
                            .font(.system(size: 18))
                            .foregroundColor(.purple80)
                    }
                }

                // Content
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(resource.title)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.textPrimary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)

                        Spacer()
                    }

                    HStack(spacing: 6) {
                        Text(resource.type)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.purple80)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.purple80.opacity(0.15))
                            .cornerRadius(4)

                        Text(resource.description)
                            .font(.system(size: 12))
                            .foregroundColor(.textTertiary)
                            .lineLimit(1)
                    }
                }

                // Arrow
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 22))
                    .foregroundColor(.purple80)
            }
            .padding(14)
            .background(Color.cardBackground)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.purple80.opacity(0.2), lineWidth: 1)
            )
        }
        .buttonStyle(PlainButtonStyle())
        .disabled(isCreating)
        .opacity(isCreating ? 0.7 : 1)
    }
}

// MARK: - Supporting Views

struct MindMapFeatureRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundColor(.purple80)
                .frame(width: 24)

            Text(text)
                .font(.system(size: 14))
                .foregroundColor(.textSecondary)
        }
    }
}


// MARK: - Color Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 187, 134, 252) // Default to purple80
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
