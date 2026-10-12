import SwiftUI

struct PlanPreviewPage: View {
  @Binding var state: MapPreviewState
  var saved: Bool
  var close: () -> Void
  var go: () -> Void
  /// Start a friend's plan I've joined: (server plan ID, stop place IDs).
  var goJoined: ((String, [String]) -> Void)? = nil
  /// The AI button's state: while it holds a suggestion, the timeline shows the plan as it would be after Apply.
  var assistant: PlanAssistant? = nil
  var applySuggestion: () -> Void = {}
  var dismissSuggestion: () -> Void = {}
  private var times: [String: PreviewStopTime] { shown.times }
  private var suggestion: AskResponseDTO? { saved ? nil : assistant?.suggestion }
  /// The plan after Apply, while a suggestion waits; otherwise the plan itself.
  private var shown: PlanContents { suggestion?.preview.map(PlanContents.init(server:)) ?? state.planContents }
  private var removedBySuggestion: [MapSamplePlace] {
    guard suggestion != nil else { return [] }
    return state.planIDs.filter { !shown.ids.contains($0) }.compactMap(MapSamplePlace.find)
  }
  private enum RowMark { case none, added, retimed }
  private func mark(_ id: String) -> RowMark {
    guard suggestion != nil else { return .none }
    if !state.planIDs.contains(id) { return .added }
    let before = state.stopTimes?[id]
    return before?.arrival != shown.times[id]?.arrival || before?.durationMinutes != shown.times[id]?.durationMinutes
      ? .retimed : .none
  }
  @State private var editor: MapSamplePlace?
  @State private var participants: MapSamplePlace?
  @State private var help = false
  @State private var compact = false
  @State private var showDrawer = false
  @State private var showSaveOptions = false
  @State private var saveModal = false
  @State private var sharingModal = false
  @State private var saveFeedback: String?
  @State private var viewingPost: SavedReference?
  @State private var openPlace: SavedReference?
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @ScaledMetric(relativeTo: .footnote) private var timeColumnWidth: CGFloat = 84
  private var warning: Bool { !state.timingConflicts.isEmpty }
  var body: some View {
    VStack(spacing: HermiSpacing.standard) {
      Capsule().fill(HermiPalette.secondary.opacity(0.5)).frame(width: 36, height: 4).padding(.top, 10)
        .frame(height: 24).frame(maxWidth: .infinity).contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 10).exclusively(before: TapGesture()).onEnded { gesture in
          switch gesture {
          case .first(let drag):
            if abs(drag.translation.height) > 30 && abs(drag.translation.height) > abs(drag.translation.width) { compact = drag.translation.height > 0 }
          case .second: compact.toggle()
          }
        })
        .accessibilityLabel(compact ? "Expand My Plan to full page" : "Collapse My Plan")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { compact.toggle() }
      HStack {
        CloseButton { close() }
          .accessibilityLabel("Close planning").controlHelp("Close planning and return to your previous page")
        Text(saved ? "Saved" : "My Plan").font(HermiTypography.title)
        Spacer()
        if saved {
          Button { state.sheet = .plan } label: {
            PixelIcon(name: "saved").frame(width: 22, height: 26).frame(width: 44, height: 44)
          }.accessibilityLabel("Return to My Plan")
            .controlHelp("Close full Saved list and return to My Plan")
        } else {
          Button { state.undoPlanEdit(); saveFeedback = nil } label: {
            Image(systemName: "arrow.uturn.backward")
              .font(.system(size: 16, weight: .semibold))
              .frame(width: 44, height: 44)
          }
          .disabled(!state.canUndoPlan).opacity(state.canUndoPlan ? 1 : 0.4)
          .accessibilityLabel("Undo")
          .accessibilityHint("Undo the last change to stops, times or invite selections")
          PixelIcon(name: "save").frame(width: 22, height: 26).frame(width: 44, height: 44)
            .contentShape(Rectangle())
            .gesture(LongPressGesture(minimumDuration: 0.4).exclusively(before: TapGesture()).onEnded { gesture in
              switch gesture {
              case .first(let held): if held { showSaveOptions = true }
              case .second: showDrawer.toggle()
              }
            })
            .accessibilityLabel(showDrawer ? "Hide Saved row" : "Show Saved row")
            .accessibilityHint(state.editingSavedPlan == nil ? "Tap for Saved inside My Plan. Hold for Save current plan" : "Tap for Saved. Hold for sharing draft preferences")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { showDrawer.toggle() }
            .accessibilityAction(named: "Bookmark options") { showSaveOptions = true }
            // This hold is the Save Plan action, not a control-description popup.
            .help(state.editingSavedPlan == nil ? "Tap to show Saved here. Hold to save the current plan" : "Tap for Saved. Hold for sharing draft preferences; edits autosave locally")
        }
      }.padding(.horizontal, HermiSpacing.standard)
      if saved {
        SavedGrid(state: $state, feedback: saveFeedback, append: append) { id in
          if state.openSavedPlan(id) { saveFeedback = nil; showDrawer = false }
        }
      }
      else {
        if state.editingSavedPlan != nil {
          HStack(spacing: HermiSpacing.medium) {
            Text(state.editingSavedPlan?.name ?? "Saved plan")
              .font(HermiTypography.label).fixedSize(horizontal: false, vertical: true)
            Spacer()
            Button("My draft") { state.returnToPlanDraft(); saveFeedback = nil }
              .font(HermiTypography.label).frame(minHeight: 44)
              .controlHelp("Return to your preserved unfinished plan")
          }
          .padding(.horizontal, HermiSpacing.gutter)
          .padding(.vertical, HermiSpacing.tight)
        }
        if showDrawer { savedDrawer }
        if LiveSession.shared.isLive, let goJoined { InvitationsSection(goJoined: goJoined) }
        if let saveFeedback {
          Text(saveFeedback).font(HermiTypography.metadata).padding(.horizontal, HermiSpacing.gutter).accessibilityAddTraits(.updatesFrequently)
        }
        if !state.planIDs.isEmpty {
          HStack {
            Button { help.toggle() } label: { PixelIcon(name: "clock").frame(width: 24, height: 24).frame(width: 44, height: 44) }
              .accessibilityLabel("Timeline help")
              .accessibilityHint("Explains editing times and reordering stops")
            if state.planIDs.count > 1 {
              Text("Hold a stop to reorder").font(HermiTypography.metadata).foregroundStyle(HermiPalette.secondary)
            }
            Spacer()
          }.padding(.horizontal, HermiSpacing.standard)
          if help {
            Text("Set arrival, stay length and a reminder preference for each place. Reminders are not scheduled in preview.")
              .font(HermiTypography.metadata).padding(.horizontal, HermiSpacing.gutter)
          }
        }
        if dynamicTypeSize.isAccessibilitySize { timeline }
        else { ScrollView { timeline } }
        if let suggestion {
          SuggestionBar(suggestion: suggestion, applying: assistant?.phase == .applying,
                        apply: applySuggestion, dismiss: dismissSuggestion)
            .padding(.horizontal, 18)
        } else if warning {
          Text("Some stops overlap or run backwards. Edit their times or continue with Go!")
            .font(HermiTypography.metadata).foregroundStyle(HermiPalette.ink).padding(HermiSpacing.medium)
            .background(HermiPalette.coral.opacity(0.25), in: PixelPanel(corner: 6)).padding(.horizontal, HermiSpacing.gutter)
        }
        if suggestion == nil {
        Button { if state.canStartPlan { go() } } label: {
          Text("Go!").font(HermiTypography.title).padding(.horizontal, HermiSpacing.section)
            .frame(minWidth: 130, minHeight: 62)
            .foregroundStyle(HermiPalette.ink)
            .background(state.canStartPlan ? HermiPalette.lime : HermiPalette.line, in: PixelPanel(corner: 18))
        }.disabled(!state.canStartPlan)
          .accessibilityHint("Opens Action preview. No real trip, tracking or notifications begin")
          .controlHelp(!state.canStartPlan ? "Add at least one place before Go" : "Enter Action preview: Directions and Camera")
        }
        Text("Local plan preview · reminders and invitations are not sent")
          .font(HermiTypography.metadata).foregroundStyle(HermiPalette.secondary)
          .fixedSize(horizontal: false, vertical: true).padding(.horizontal, HermiSpacing.gutter)
      }
    }
    .modifier(PlanReadingScroll(enabled: dynamicTypeSize.isAccessibilitySize && !saved))
    .buttonStyle(.plain)
    .padding(.bottom, 115)
    .frame(maxWidth: .infinity)
    .frame(maxHeight: compact ? 560 : .infinity)
    .background(HermiPalette.paper, in: UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20))
    .frame(maxHeight: .infinity, alignment: .bottom)
    .onAppear {
      // Migrate old preview drafts once into the durable plan snapshot.
      if state.stopTimes == nil {
        let data = UserDefaults.standard.data(forKey: "hermi.preview.stopTimes")
        let old = data.flatMap { try? JSONDecoder().decode([String: PreviewStopTime].self, from: $0) } ?? [:]
        state.stopTimes = old.filter { state.planIDs.contains($0.key) && $0.value.isValid }
      }
      if state.stopInviteDrafts == nil {
        state.stopInviteDrafts = Dictionary(uniqueKeysWithValues: state.planIDs.map {
          ($0, Set(UserDefaults.standard.stringArray(forKey: "hermi.preview.invites.\($0)") ?? []))
        })
      }
    }
    .sheet(item: $openPlace) { reference in
      PlaceSheet(state: $state, placeID: reference.refID) { openPlace = nil }
    }
    .coverScreen(item: $viewingPost) { reference in
      SavedViewer(state: $state, reference: reference, close: { viewingPost = nil },
                  openPlan: { id in viewingPost = nil; _ = state.openSavedPlan(id) }, append: append)
    }
    .sheet(item: $editor) { place in
      StopTimeEditor(place: place, value: times[place.id]) { state.setStopTime($0, for: place.id) }
    }
    .sheet(item: $participants) { place in
      ParticipantPreview(place: place, initialSelection: state.stopInviteDrafts?[place.id] ?? [], save: {
        state.setInviteDraft($0, for: place.id)
      }, remove: { state.removePlace(place.id) })
    }
    .sheet(isPresented: $saveModal) {
      SavePlanPreviewModal(folders: state.library.folders, stopCount: state.planIDs.count) { name, folderID, newFolder, visibility, friends in
        var library = state.library
        let didSave = library.savePlan(name: name, folderID: folderID, newFolder: newFolder,
                                       visibility: visibility, friends: friends, stops: state.planIDs,
                                       times: state.stopTimes ?? [:], legs: state.stopLegs)
        if didSave {
          state.library = library
          if let id = library.plans.last?.id { state.bindNewSavedPlan(id) }
          saveFeedback = LiveSession.shared.isLive ? (visibility == .friends ? "Plan saved. Invites sent." : "Plan saved to your account.") : (visibility == .solo ? "Plan saved locally." : "Plan draft saved locally. Nothing was shared or sent.")
        }
        return didSave
      }
    }
    .sheet(isPresented: $sharingModal) {
      if let plan = state.editingSavedPlan {
        PlanSharingDraftEditor(plan: plan) { visibility, friends in
          _ = state.setSharingIntent(visibility: visibility, friends: friends)
          saveFeedback = "Sharing preferences saved locally. Nothing sent."
        }
      }
    }
    .overlay {
      if showSaveOptions {
        ZStack(alignment: .topTrailing) {
          Color.black.opacity(0.08).contentShape(Rectangle())
            .onTapGesture { showSaveOptions = false }
            .accessibilityLabel("Dismiss save options")
            .accessibilityAddTraits(.isButton)
          VStack(alignment: .leading, spacing: 10) {
            Text("SAVE").font(.system(size: 10, design: .monospaced).bold())
              .foregroundStyle(HermiPalette.secondary)
            if state.editingSavedPlan == nil {
              Button {
                showSaveOptions = false
                saveModal = true
              } label: {
                HStack(spacing: 8) {
                  PixelIcon(name: "save").frame(width: 17, height: 20)
                  Text("Save current plan").font(.subheadline.bold())
                }.frame(minHeight: 44)
              }.accessibilityLabel("Save current plan")
                .controlHelp("Name this plan, choose a folder and set visibility")
            } else {
              Text("Saved automatically").font(.caption)
              Button("Sharing draft") { showSaveOptions = false; sharingModal = true }
                .font(.subheadline.bold()).frame(minHeight: 44)
                .controlHelp("Review local audience preferences; no invitations or publishing")
            }
          }.padding(14).frame(width: 210, alignment: .leading)
            .background(HermiPalette.controlSurface, in: PixelPanel(corner: 7))
            .overlay(PixelPanel(corner: 7).stroke(HermiPalette.ink.opacity(0.2)))
            .padding(.top, 86).padding(.trailing, 18)
        }
      }
    }
  }

  private var timeline: some View {
    LazyVStack(spacing: HermiSpacing.standard) {
      if state.planIDs.isEmpty {
        VStack(alignment: .leading, spacing: HermiSpacing.small) {
          Text("Your plan starts with a place").font(HermiTypography.heading)
          Text("Add an explicit place from Map, Feed or Saved. It will appear here when you choose Add.")
            .font(HermiTypography.body).foregroundStyle(HermiPalette.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(HermiSpacing.medium)
        .background(HermiPalette.controlSurface, in: PixelPanel(corner: 8))
        .overlay(PixelPanel(corner: 8).stroke(HermiPalette.line, lineWidth: 1))
      }
      ForEach(Array(shown.ids.enumerated()), id: \.element) { index, id in
        if let place = MapSamplePlace.find(id) {
          if index > 0, suggestion != nil || !(shown.legs ?? [:]).isEmpty {
            LegRow(leg: shown.leg(into: id),
                   changed: suggestion != nil && shown.leg(into: id) != state.planContents.leg(into: id))
          }
          stopRow(place)
        }
      }
      if !removedBySuggestion.isEmpty {
        Text("Removes " + removedBySuggestion.map(\.name).joined(separator: ", "))
          .font(HermiTypography.metadata).strikethrough().foregroundStyle(HermiPalette.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }.padding(.horizontal, HermiSpacing.gutter).padding(.vertical, HermiSpacing.small)
  }

  private func stopRow(_ place: MapSamplePlace) -> some View {
    let mark = mark(place.id)
    let isAccessibilityLayout = dynamicTypeSize.isAccessibilitySize
    // Keep the schedule as a stable left-hand column at large text sizes. A
    // bounded scaled width gives the stop card most of the row while allowing
    // time details to wrap inside their own column when necessary.
    let readableTimeWidth = min(max(timeColumnWidth, 104), 132)
    let layout = AnyLayout(HStackLayout(
      alignment: isAccessibilityLayout ? .top : .center,
      spacing: HermiSpacing.medium
    ))
    return layout {
      Button { editor = place } label: {
        VStack(alignment: .leading, spacing: HermiSpacing.tight) {
          if let time = times[place.id] {
            Text(time.arrival, format: .dateTime.month(.abbreviated).day())
              .font(HermiTypography.metadata).foregroundStyle(HermiPalette.secondary)
            Text(time.arrival, format: .dateTime.hour(.defaultDigits(amPM: .omitted)).minute())
              .font(HermiTypography.label).monospacedDigit()
              .lineLimit(1).minimumScaleFactor(0.68).allowsTightening(true)
              .foregroundStyle(mark == .none ? HermiPalette.ink : HermiPalette.green)
            if let period = localizedDayPeriod(for: time.arrival) {
              Text(period).font(HermiTypography.metadata).foregroundStyle(HermiPalette.secondary)
            }
            if isAccessibilityLayout {
              Text("\(time.durationMinutes)m").font(HermiTypography.metadata).foregroundStyle(HermiPalette.secondary)
              if time.reminderMinutes > 0 {
                Text("\(time.reminderMinutes)m before").font(HermiTypography.metadata).foregroundStyle(HermiPalette.secondary)
              }
            } else {
              Text("\(time.durationMinutes)m" + (time.reminderMinutes > 0 ? " · \(time.reminderMinutes)m before" : ""))
                .font(HermiTypography.metadata).foregroundStyle(HermiPalette.secondary)
            }
          } else { Text("Set time").font(HermiTypography.metadata) }
        }.fixedSize(horizontal: false, vertical: true)
          .frame(width: isAccessibilityLayout ? readableTimeWidth : timeColumnWidth, alignment: .leading)
          .frame(minWidth: 44, minHeight: 64, alignment: .leading)
          .contentShape(Rectangle())
      }.accessibilityLabel("Edit time for \(place.name)")
        .controlHelp("Edit arrival, duration and reminder for \(place.name)")
      HStack(spacing: HermiSpacing.tight) {
        Button { openPlace = SavedReference(kind: .place, refID: place.id) } label: {
          Text(place.name).font(HermiTypography.body).fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        }.help("Open place details. Hold and drag this row to reorder")
        Button { participants = place } label: { PixelIcon(name: "menu").frame(width: 22, height: 16).frame(width: 44, height: 48) }
          .accessibilityLabel("Who's going to \(place.name)")
          .controlHelp("View attendees and choose existing friends to invite")
      }.padding(.leading, HermiSpacing.medium).background(HermiPalette.category(place.category).opacity(0.32), in: PixelPanel(corner: 8))
        .overlay(alignment: .topTrailing) {
          if mark == .added {
            Text("NEW").font(.system(size: 9, design: .monospaced).bold()).padding(.horizontal, 5).padding(.vertical, 2)
              .background(HermiPalette.lime, in: PixelPanel(corner: 2)).padding(4)
          }
        }
        .overlay(PixelPanel(corner: 8).stroke(HermiPalette.green, lineWidth: mark == .added ? 2 : 0).allowsHitTesting(false))
        .accessibilityValue(mark == .added ? "Suggested new stop" : mark == .retimed ? "Suggested new time" : "")
        .draggable(place.id) { Text("Move \(place.name)").padding(12).background(HermiPalette.category(place.category)) }
        .dropDestination(for: String.self) { ids, point in
          guard let id = ids.first, state.planIDs.contains(id) else { return false }
          state.movePlace(id, relativeTo: place.id, after: point.y > 27); return true
        }
        .accessibilityAction(named: "Move earlier") {
          if let index = state.planIDs.firstIndex(of: place.id), index > 0 { state.movePlace(place.id, before: state.planIDs[index-1]) }
        }
        .accessibilityAction(named: "Move later") {
          if let index = state.planIDs.firstIndex(of: place.id), index+1 < state.planIDs.count {
            state.movePlace(place.id, relativeTo: state.planIDs[index+1], after: true)
          }
        }
    }
  }

  private func localizedDayPeriod(for date: Date) -> String? {
    let locale = Locale.autoupdatingCurrent
    guard locale.hourCycle == .oneToTwelve else { return nil }
    let formatter = DateFormatter()
    formatter.locale = locale
    formatter.setLocalizedDateFormatFromTemplate("a")
    return formatter.string(from: date)
  }

  private var savedDrawer: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("SAVED · SWIPE SIDEWAYS").font(.system(size: 10, design: .monospaced))
          .foregroundStyle(HermiPalette.secondary)
        Spacer()
        Button("See all") { state.sheet = .saved }
          .font(.caption.bold()).foregroundStyle(HermiPalette.green)
          .accessibilityLabel("Open full Saved list")
          .controlHelp("Open all saved folders and items")
      }.padding(.horizontal, 20)
      ScrollView(.horizontal) {
        LazyHStack(spacing: 10) {
          ForEach(state.savedReferences) { reference in
            VStack(alignment: .leading, spacing: 10) {
              Text(reference.kind.rawValue.capitalized).font(HermiTypography.metadata).foregroundStyle(HermiPalette.secondary)
              Button { openSaved(reference) } label: {
                Text(savedTitle(reference)).font(HermiTypography.label).fixedSize(horizontal: false, vertical: true)
                  .frame(maxWidth: .infinity, alignment: .leading)
              }
                .controlHelp(reference.kind == .plan ? "Open this saved plan for editing; preserve your current draft" : "Open place details")
              Spacer(minLength: 0)
              Button { append(reference) } label: {
                PixelIcon(name: "plus").frame(width: 18, height: 18).frame(width: 40, height: 40)
                  .background(HermiPalette.lime, in: PixelPanel(corner: 5))
              }.accessibilityLabel("Add \(savedTitle(reference)) to current plan")
                .controlHelp("Append explicit places; existing stops are skipped")
            }.padding(HermiSpacing.medium).frame(width: 158, alignment: .leading).frame(minHeight: 140)
              .background(HermiPalette.category(MapSamplePlace.find(reference.refID)?.category ?? .culture).opacity(0.3), in: PixelPanel(corner: 6))
          }
          if state.savedReferences.isEmpty { Text("Nothing saved yet").font(.caption).frame(height: 90) }
        }.padding(.horizontal, 18)
      }.scrollIndicators(.hidden).frame(height: 138)
    }.accessibilityElement(children: .contain)
  }

  private func savedTitle(_ reference: SavedReference) -> String {
    switch reference.kind {
    case .place: return MapSamplePlace.find(reference.refID)?.name ?? "Unavailable place"
    case .post:
      guard let post = PlaceFeedPost.find(reference.refID) else { return "Unavailable post" }
      return "\(post.author) · \(MapSamplePlace.find(post.placeID)?.name ?? "Post")"
    case .plan: return state.library.plan(reference.refID)?.name ?? "Unavailable plan"
    }
  }

  private func append(_ reference: SavedReference) {
    let result = state.appendSaved(reference)
    saveFeedback = result.unavailable > 0 ? "Some places are unavailable." :
      result.added > 0 ? "Added \(result.added) stop\(result.added == 1 ? "" : "s")\(result.skipped > 0 ? " · \(result.skipped) already in plan" : "")." :
      "Already in your plan."
  }

  private func openSaved(_ reference: SavedReference) {
    if reference.kind == .post { viewingPost = reference; return }
    if reference.kind == .plan {
      if state.openSavedPlan(reference.refID) { saveFeedback = nil; showDrawer = false }
    } else if reference.kind == .place { openPlace = reference }
  }
}

/// Large reading sizes scroll the whole Plan rather than squeezing its timeline
/// between growing headers and footers. Normal sizes retain the existing layout.
private struct PlanReadingScroll: ViewModifier {
  let enabled: Bool
  @ViewBuilder func body(content: Content) -> some View {
    if enabled { ScrollView { content }.frame(maxWidth: .infinity, maxHeight: .infinity) }
    else { content }
  }
}

private struct StopTimeEditor: View {
  let place: MapSamplePlace
  var save: (PreviewStopTime?) -> Void
  @State private var draft: PreviewStopTime
  @Environment(\.dismiss) private var dismiss
  init(place: MapSamplePlace, value: PreviewStopTime?, save: @escaping (PreviewStopTime?) -> Void) {
    self.place = place; self.save = save
    _draft = State(initialValue: value ?? PreviewStopTime(arrival: Date().addingTimeInterval(3600)))
  }
  var body: some View {
    NavigationStack {
      Form {
        DatePicker("Arrival", selection: $draft.arrival)
        Stepper("Stay: \(draft.durationMinutes) minutes", value: $draft.durationMinutes, in: 5...1440, step: 5)
        Picker("Remind me", selection: $draft.reminderMinutes) {
          Text("Off").tag(0); Text("5 minutes before").tag(5); Text("15 minutes before").tag(15); Text("30 minutes before").tag(30)
        }
        Text("Preview preference only. Notifications are not scheduled.").font(.caption)
        Button("Clear time", role: .destructive) { save(nil); dismiss() }
      }.scrollContentBackground(.hidden).background(HermiPalette.paper).navigationTitle(place.name)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.controlHelp("Discard time edits") }
          ToolbarItem(placement: .confirmationAction) { Button("Save") { save(draft); dismiss() }.controlHelp("Save this stop's local time and reminder preference") }
        }
    }
  }
}
private struct ParticipantPreview: View {
  let place: MapSamplePlace
  let initialSelection: Set<String>
  var save: (Set<String>) -> Void
  var remove: () -> Void
  @State private var selected: Set<String> = []
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      Form {
        Section("Who's going") { Text("No confirmed attendees loaded.") }
        Section(LiveSession.shared.isLive ? "Invite existing friends" : "Invite existing friends · sample list") {
          ForEach(FriendDirectory.shared.names, id: \.self) { name in
            Toggle(name, isOn: Binding(get: { selected.contains(name) }, set: { if $0 { selected.insert(name) } else { selected.remove(name) } }))
          }
        }
        Text("Draft only. Saving this preview list sends no invitations and does not confirm attendance.").font(.caption)
        Section {
          Button("Remove stop from plan", role: .destructive) { remove(); dismiss() }
        }
      }.scrollContentBackground(.hidden).background(HermiPalette.paper).navigationTitle(place.name)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
          ToolbarItem(placement: .confirmationAction) { Button("Save draft") {
            save(selected); dismiss()
          } }
        }
    }.tint(HermiPalette.green).onAppear { selected = initialSelection }
  }
}
