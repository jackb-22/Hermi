import SwiftUI

// The AI button on My Plan: a pixel button beside the Home pill, a menu of three presets and a chat. It only
// suggests edits to the open plan; the plan shows them as a preview until Apply.

/// Bottom-left, level with the Home pill. Shown only while My Plan is open.
struct AssistantButton: View {
  var assistant: PlanAssistant
  var body: some View {
    Button { assistant.isOpen ? assistant.close() : assistant.open() } label: {
      ZStack {
        PixelPanel(corner: 9).fill(assistant.isOpen ? HermiPalette.ink : HermiPalette.lime)
        PixelPanel(corner: 9).stroke(HermiPalette.ink.opacity(0.25))
        PixelSprite(rows: AssistantButton.spark, colors: ["I": assistant.isOpen ? HermiPalette.lime : HermiPalette.ink])
          .frame(width: 24, height: 16)
      }.frame(width: 52, height: 52).frame(width: 60, height: 60).contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(assistant.isOpen ? "Close Hermi AI" : "Hermi AI")
    .accessibilityIdentifier("ai-button")
    .controlHelp("Space your stops, pick the best weather day, add a stop or ask about this plan")
  }
  static let spark = ["    I      ", "    I      ", "   III     ", "IIIIIIIII I", "   III   III", "    I     I ", "    I      "]
}

/// The presets, above the button. Picking one closes the card so the preview can be seen.
struct AssistantMenuCard: View {
  var assistant: PlanAssistant
  var ask: (AssistantPreset) -> Void
  /// The screen's width and height, so the card fits a small phone and large text.
  var room: CGSize = CGSize(width: 390, height: 800)
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ScrollView {
      content
    }
    .scrollBounceBehavior(.basedOnSize)
    .frame(width: min(340, room.width - 20))
    .frame(maxHeight: room.height * 0.62)
    .fixedSize(horizontal: false, vertical: true)
    .background(HermiPalette.controlSurface, in: PixelPanel(corner: 10))
    .overlay(PixelPanel(corner: 10).stroke(HermiPalette.ink.opacity(0.2)).allowsHitTesting(false))
    .dynamicTypeSize(...DynamicTypeSize.accessibility1)
    .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: assistant.phase)
  }

  private var content: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        CloseButton(label: "Close Hermi AI") { assistant.close() }
        VStack(alignment: .leading, spacing: 1) {
          Text("Hermi AI").font(.headline)
          Text("Suggests changes to this plan").font(.caption2).foregroundStyle(HermiPalette.secondary)
        }
        Spacer(minLength: 0)
      }
      if case .asking(let title) = assistant.phase {
        HStack(spacing: 12) {
          HermitBrandMark(emergence: 1, stride: 0).frame(width: 30, height: 34)
          VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.subheadline.bold())
            Text("Checking travel times, hours and weather…").font(.caption).foregroundStyle(HermiPalette.secondary)
          }
        }.frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
          .accessibilityElement(children: .combine)
      } else if assistant.phase == .categories {
        categoryPicker
      } else {
        row(icon: "route", title: "Space it out", detail: "Travel time between stops") { ask(.space) }
          .accessibilityIdentifier("ai-space")
        row(icon: "clock", title: "Best weather day", detail: "The next 10 days") { ask(.weather) }
          .accessibilityIdentifier("ai-weather")
        row(icon: "plus", title: "Add a stop…", detail: "Pick a kind of place") { assistant.showCategories() }
          .accessibilityIdentifier("ai-add")
        row(icon: "spark", title: "Ask about this plan", detail: "Chat with Hermi") { assistant.showChat() }
          .accessibilityIdentifier("ai-chat")
      }
      if let notice = assistant.notice {
        Text(notice).font(.caption).padding(10).frame(maxWidth: .infinity, alignment: .leading)
          .background(HermiPalette.coral.opacity(0.22), in: PixelPanel(corner: 5))
          .accessibilityAddTraits(.updatesFrequently)
      }
    }
    .padding(12)
  }

  private var categoryPicker: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Button { assistant.back() } label: {
          PixelIcon(name: "back").frame(width: 14, height: 10).frame(width: 44, height: 36)
        }.accessibilityLabel("Back to presets")
        Text("Add a stop").font(.subheadline.bold())
      }
      LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 4), spacing: 6) {
        ForEach(HermiCategory.allCases, id: \.self) { category in
          Button { ask(.add(category)) } label: {
            VStack(spacing: 4) {
              CategorySprite(category: category).frame(width: 18, height: 18)
              Text(category.rawValue).font(.system(size: 10, weight: .medium)).lineLimit(1).minimumScaleFactor(0.8)
            }.frame(maxWidth: .infinity, minHeight: 52)
              .background(HermiPalette.category(category).opacity(0.35), in: PixelPanel(corner: 5))
          }.accessibilityLabel("Add a \(category.rawValue.lowercased()) stop")
            .accessibilityIdentifier("ai-add-\(category.serverName)")
        }
      }
    }
  }

  private func row(icon: String, title: String, detail: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack(spacing: 12) {
        PixelIcon(name: icon).frame(width: 18, height: 16).frame(width: 34, height: 34)
          .background(HermiPalette.lime.opacity(0.55), in: PixelPanel(corner: 5))
        VStack(alignment: .leading, spacing: 1) {
          Text(title).font(.subheadline.bold()).fixedSize(horizontal: false, vertical: true)
          Text(detail).font(.caption).foregroundStyle(HermiPalette.secondary).fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 0)
      }.frame(minHeight: 48).contentShape(Rectangle())
    }.buttonStyle(.plain).disabled(assistant.isBusy)
  }
}

/// While a suggestion waits: what it does, and Apply / Dismiss (in place of Go!).
struct SuggestionBar: View {
  var suggestion: AskResponseDTO
  var applying: Bool
  var apply: () -> Void
  var dismiss: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .top, spacing: 8) {
        PixelSprite(rows: AssistantButton.spark, colors: ["I": HermiPalette.green]).frame(width: 18, height: 12).padding(.top, 3)
        Text(suggestion.message).font(.subheadline).fixedSize(horizontal: false, vertical: true)
      }
      ForEach(suggestion.plan.ghostChanges ?? []) { change in
        Text("· " + change.label).font(.caption).foregroundStyle(HermiPalette.secondary)
      }
      SourceLinks(sources: suggestion.sources)
      // Side by side; stacked (Apply first) when large text would clip them.
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 10) { dismissButton; applyButton }
        VStack(spacing: 8) { applyButton; dismissButton }
      }.buttonStyle(.plain)
    }
    .padding(12)
    .background(HermiPalette.lime.opacity(0.18), in: PixelPanel(corner: 8))
    .overlay(PixelPanel(corner: 8).stroke(HermiPalette.green.opacity(0.5)))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Suggested changes")
    .dynamicTypeSize(...DynamicTypeSize.accessibility1)
  }

  private var dismissButton: some View {
    Button(action: dismiss) {
      Text("Dismiss").font(.subheadline.bold()).lineLimit(1).fixedSize()
        .frame(maxWidth: .infinity, minHeight: 48)
        .background(HermiPalette.controlSurface, in: PixelPanel(corner: 8))
        .overlay(PixelPanel(corner: 8).stroke(HermiPalette.ink.opacity(0.2)))
    }.accessibilityIdentifier("ai-dismiss")
  }
  private var applyButton: some View {
    Button(action: apply) {
      Text(applying ? "Applying…" : "Apply").font(.subheadline.bold()).lineLimit(1).fixedSize()
        .frame(maxWidth: .infinity, minHeight: 48)
        .background(HermiPalette.lime, in: PixelPanel(corner: 8))
    }.accessibilityIdentifier("ai-apply").disabled(applying)
  }
}

/// Google Maps sources, right under the text they support.
struct SourceLinks: View {
  var sources: [SourceDTO]
  var body: some View {
    ForEach(sources, id: \.uri) { source in
      if let url = URL(string: source.uri) {
        Link(destination: url) {
          Text("↗ \(source.title) · Google Maps").font(.caption2.bold()).foregroundStyle(HermiPalette.green)
        }.frame(minHeight: 28)
      }
    }
  }
}

/// Travel into a stop, between two rows of the timeline.
struct LegRow: View {
  var leg: PreviewLeg?
  var changed = false
  var body: some View {
    HStack(spacing: 8) {
      Rectangle().fill(HermiPalette.line).frame(width: 2, height: 16).padding(.leading, 31)
      if let leg {
        PixelIcon(name: LegRow.icon(leg.mode)).frame(width: 10, height: 12)
        Text("\(leg.minutes) min \(LegRow.verb(leg.mode))\(leg.isEstimate ? " · est." : "")")
          .font(.caption2.bold())
          .foregroundStyle(changed ? HermiPalette.green : HermiPalette.secondary)
      } else {
        Text("travel time unknown").font(.caption2).foregroundStyle(HermiPalette.secondary.opacity(0.7))
      }
      Spacer()
    }
    .frame(height: 18)
    .accessibilityElement(children: .combine)
  }
  static func icon(_ mode: String) -> String {
    switch mode { case "transit": return "transit"; case "bike": return "bike"; case "car": return "car"; default: return "walk" }
  }
  static func verb(_ mode: String) -> String {
    switch mode { case "transit": return "by transit"; case "bike": return "by bike"; case "car": return "drive"; default: return "walk" }
  }
}

/// Chat with Hermi about this plan, in a sheet so the plan (and any preview) stays visible above it.
struct AssistantChatSheet: View {
  var assistant: PlanAssistant
  var send: () -> Void
  var apply: () -> Void
  var dismissSuggestion: () -> Void
  @FocusState private var focused: Bool

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        CloseButton(label: "Close chat") { assistant.back() }
        Text("Ask Hermi").font(.headline)
        Spacer()
      }.padding(.horizontal, 12).padding(.top, 10)
      ScrollViewReader { scroller in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 10) {
            if assistant.lines.isEmpty {
              Text("Ask about your stops, or ask for a change: “make it cheaper”, “somewhere to eat after the gallery”, “is the café open then?”")
                .font(.caption).foregroundStyle(HermiPalette.secondary).padding(.vertical, 8)
            }
            ForEach(assistant.lines) { line in bubble(line).id(line.id) }
            if case .asking = assistant.phase {
              HStack(spacing: 8) {
                HermitBrandMark(emergence: 1, stride: 0).frame(width: 22, height: 25)
                Text("Thinking…").font(.caption).foregroundStyle(HermiPalette.secondary)
              }.id("thinking")
            }
            if let suggestion = assistant.suggestion {
              SuggestionBar(suggestion: suggestion, applying: assistant.phase == .applying,
                            apply: apply, dismiss: dismissSuggestion).id("suggestion")
            }
            if let notice = assistant.notice {
              Text(notice).font(.caption).padding(10)
                .background(HermiPalette.coral.opacity(0.22), in: PixelPanel(corner: 5))
            }
          }.padding(12)
        }
        .onChange(of: assistant.lines.count) { _, _ in
          if let last = assistant.lines.last { scroller.scrollTo(last.id, anchor: .bottom) }
        }
      }
      HStack(spacing: 8) {
        TextField("Ask about this plan", text: Binding(get: { assistant.draft }, set: { assistant.draft = String($0.prefix(300)) }),
                  axis: .vertical)
          .lineLimit(1...4).focused($focused).submitLabel(.send).onSubmit(send)
          .padding(10).background(HermiPalette.controlSurface, in: PixelPanel(corner: 7))
          .overlay(PixelPanel(corner: 7).stroke(HermiPalette.ink.opacity(0.2)))
          .accessibilityIdentifier("ai-chat-field")
        Button(action: send) {
          PixelIcon(name: "send").frame(width: 12, height: 14).frame(width: 44, height: 44)
            .background(HermiPalette.lime, in: PixelPanel(corner: 7))
        }.buttonStyle(.plain).accessibilityLabel("Send")
          .disabled(assistant.isBusy || assistant.draft.trimmingCharacters(in: .whitespaces).isEmpty)
      }.padding(12)
    }
    .background(HermiPalette.paper)
    .foregroundStyle(HermiPalette.ink)
  }

  private func bubble(_ line: AssistantLine) -> some View {
    VStack(alignment: line.role == .user ? .trailing : .leading, spacing: 4) {
      Text(line.text).font(.subheadline).padding(10)
        .background(line.role == .user ? HermiPalette.lake.opacity(0.28) : HermiPalette.controlSurface, in: PixelPanel(corner: 6))
      SourceLinks(sources: line.sources)
    }.frame(maxWidth: .infinity, alignment: line.role == .user ? .trailing : .leading)
      .accessibilityElement(children: .combine)
      .accessibilityLabel((line.role == .user ? "You: " : "Hermi: ") + line.text)
  }
}
