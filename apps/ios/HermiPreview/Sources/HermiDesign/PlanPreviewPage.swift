import SwiftUI

struct PreviewStopTime: Codable, Equatable {
  var arrival: Date
  var durationMinutes: Int = 60
  var reminderMinutes: Int = 0
}
struct PlanPreviewPage: View {
  @Binding var state: MapPreviewState
  var saved: Bool
  var close: () -> Void
  var go: () -> Void
  @State private var times: [String: PreviewStopTime] = [:]
  @State private var editor: MapSamplePlace?
  @State private var participants: MapSamplePlace?
  @State private var help = false
  @State private var compact = false
  private var warning: Bool {
    let timed = state.planIDs.compactMap { times[$0] }
    return zip(timed, timed.dropFirst()).contains { a,b in b.arrival < a.arrival.addingTimeInterval(Double(a.durationMinutes)*60) }
  }
  var body: some View {
    VStack(spacing: 16) {
      Capsule().fill(HermiPalette.secondary.opacity(0.5)).frame(width: 36, height: 4).padding(.top, 10)
        .frame(height: 24).frame(maxWidth: .infinity).contentShape(Rectangle())
        .onTapGesture { compact.toggle() }
        .gesture(DragGesture(minimumDistance: 10).onEnded { compact = $0.translation.height > 0 })
        .accessibilityLabel(compact ? "Expand My Plan to full page" : "Collapse My Plan")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { compact.toggle() }
      HStack {
        Button { close() } label: { PixelIcon(name: "back").frame(width: 20, height: 20).frame(width: 44, height: 44) }
          .controlHelp("Close planning and return to your previous page")
        Text(saved ? "Saved" : "My Plan").font(.title2.bold())
        Spacer()
        Button { state.sheet = saved ? .plan : .saved } label: {
          PixelIcon(name: saved ? "saved" : "save").frame(width: 22, height: 26).frame(width: 44, height: 44)
        }.accessibilityLabel(saved ? "Return to My Plan" : "Open Saved")
          .controlHelp(saved ? "Close Saved and return to My Plan" : "Open saved places without changing My Plan")
      }.padding(.horizontal, 16)
      if saved { savedList }
      else {
        HStack {
          Button { help.toggle() } label: { PixelIcon(name: "clock").frame(width: 24, height: 24).frame(width: 44, height: 44) }
            .accessibilityLabel("Timeline help").controlHelp("Tap a time to edit. Hold a stop and move it to reorder")
          Text("Hold a stop to reorder").font(.caption).foregroundStyle(HermiPalette.secondary)
          Spacer()
        }.padding(.horizontal, 18)
        if help { Text("Set arrival, stay length and a reminder preference for each place. Reminders are not scheduled in preview.").font(.caption).padding(.horizontal, 20) }
        ScrollView {
          LazyVStack(spacing: 12) {
            if state.planIDs.isEmpty {
              Text("Add a place from Map, Feed or Saved.").font(.subheadline).padding(24)
            }
            ForEach(state.planIDs, id: \.self) { id in
              if let place = MapSamplePlace.find(id) { stopRow(place) }
            }
          }.padding(.horizontal, 18).padding(.vertical, 8)
        }
        if warning {
          Text("These times overlap. You can edit them or continue with this preview.")
            .font(.caption).foregroundStyle(HermiPalette.ink).padding(12)
            .background(HermiPalette.coral.opacity(0.25), in: PixelPanel(corner: 6)).padding(.horizontal, 18)
        }
        Button { go() } label: {
          Text("Go!").font(.title2.bold()).frame(width: 130, height: 62)
            .background(HermiPalette.lime, in: PixelPanel(corner: 18))
        }.disabled(state.planIDs.isEmpty)
          .accessibilityHint("Opens Action preview. No real trip, tracking or notifications begin")
          .controlHelp(state.planIDs.isEmpty ? "Add at least one place before Go" : "Enter Action preview: Directions and Camera")
        Text("Local plan preview · reminders and invitations are not sent")
          .font(.caption2).foregroundStyle(HermiPalette.secondary).padding(.horizontal, 18)
      }
    }
    .buttonStyle(.plain)
    .padding(.bottom, 115)
    .frame(maxWidth: .infinity)
    .frame(maxHeight: compact ? 450 : .infinity)
    .background(HermiPalette.paper, in: UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20))
    .frame(maxHeight: .infinity, alignment: .bottom)
    .onAppear {
      if let data = UserDefaults.standard.data(forKey: "hermi.preview.stopTimes"), let stored = try? JSONDecoder().decode([String: PreviewStopTime].self, from: data) { times = stored }
    }
    .onChange(of: times) { _, value in
      if let data = try? JSONEncoder().encode(value) { UserDefaults.standard.set(data, forKey: "hermi.preview.stopTimes") }
    }
    .sheet(item: $editor) { place in
      StopTimeEditor(place: place, value: times[place.id]) { times[place.id] = $0 }
    }
    .sheet(item: $participants) { place in ParticipantPreview(place: place) }
  }
  private func stopRow(_ place: MapSamplePlace) -> some View {
    HStack(spacing: 10) {
      Button { editor = place } label: {
        VStack(spacing: 5) {
          if let time = times[place.id] {
            Text(time.arrival, style: .time).font(.caption.bold())
            Text("\(time.durationMinutes)m").font(.caption2)
          } else { Text("Set time").font(.caption) }
        }.frame(width: 64, height: 58)
      }.accessibilityLabel("Edit time for \(place.name)")
        .controlHelp("Edit arrival, duration and reminder for \(place.name)")
      Rectangle().fill(HermiPalette.green.opacity(0.4)).frame(width: 2, height: 58)
      HStack(spacing: 4) {
        Button { state.selectPlace(place.id) } label: {
          Text(place.name).font(.subheadline).frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
        }.help("Open place details. Hold and drag this row to reorder")
        Button { participants = place } label: { PixelIcon(name: "menu").frame(width: 22, height: 16).frame(width: 44, height: 48) }
          .accessibilityLabel("Who's going to \(place.name)")
          .controlHelp("View attendees and choose existing friends to invite")
      }.padding(.leading, 12).background(HermiPalette.lime.opacity(0.35), in: Capsule())
        .draggable(place.id) { Text("Move \(place.name)").padding(12).background(HermiPalette.lime) }
        .dropDestination(for: String.self) { ids, _ in
          guard let id = ids.first, state.planIDs.contains(id) else { return false }
          state.movePlace(id, before: place.id); return true
        }
        .accessibilityAction(named: "Move earlier") {
          if let index = state.planIDs.firstIndex(of: place.id), index > 0 { state.movePlace(place.id, before: state.planIDs[index-1]) }
        }
        .accessibilityAction(named: "Move later") {
          if let index = state.planIDs.firstIndex(of: place.id), index+1 < state.planIDs.count { state.planIDs.swapAt(index, index+1) }
        }
    }
  }
  private var savedList: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 18) {
        if state.savedIDs.isEmpty { Text("No saved places yet.").padding(20) }
        ForEach(HermiCategory.allCases, id: \.self) { category in
          let places = MapSamplePlace.all.filter { $0.category == category && state.savedIDs.contains($0.id) }
          if !places.isEmpty {
            Text(category.rawValue).font(.caption.bold()).foregroundStyle(HermiPalette.secondary)
            ForEach(places) { place in
              HStack {
                Button(place.name) { state.selectPlace(place.id) }.frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                  .controlHelp("Open saved place \(place.name)")
                Button { state.togglePlan(place.id) } label: { PixelIcon(name: state.planIDs.contains(place.id) ? "check" : "plus").frame(width: 20, height: 20).frame(width: 44, height: 44) }
                  .accessibilityLabel(state.planIDs.contains(place.id) ? "Remove \(place.name) from plan" : "Add \(place.name) to plan")
                  .controlHelp("Toggle this saved place in My Plan; keep it saved")
              }.padding(.horizontal, 14).background(HermiPalette.lime.opacity(0.25), in: Capsule())
            }
          }
        }
      }.padding(20)
    }
  }
}

private struct StopTimeEditor: View {
  let place: MapSamplePlace
  var save: (PreviewStopTime) -> Void
  @State private var draft: PreviewStopTime
  @Environment(\.dismiss) private var dismiss
  init(place: MapSamplePlace, value: PreviewStopTime?, save: @escaping (PreviewStopTime) -> Void) {
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
      }.navigationTitle(place.name)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.controlHelp("Discard time edits") }
          ToolbarItem(placement: .confirmationAction) { Button("Save") { save(draft); dismiss() }.controlHelp("Save this stop's local time and reminder preference") }
        }
    }
  }
}
private struct ParticipantPreview: View {
  let place: MapSamplePlace
  @State private var selected: Set<String> = []
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      Form {
        Section("Who's going") { Text("No confirmed attendees loaded.") }
        Section("Invite existing friends · sample list") {
          ForEach(["Alex", "Sam", "Riley"], id: \.self) { name in
            Toggle(name, isOn: Binding(get: { selected.contains(name) }, set: { if $0 { selected.insert(name) } else { selected.remove(name) } }))
          }
        }
        Text("Draft only. Saving this preview list sends no invitations and does not confirm attendance.").font(.caption)
      }.navigationTitle(place.name)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
          ToolbarItem(placement: .confirmationAction) { Button("Save draft") {
            UserDefaults.standard.set(Array(selected).sorted(), forKey: "hermi.preview.invites.\(place.id)"); dismiss()
          } }
        }
    }.onAppear { selected = Set(UserDefaults.standard.stringArray(forKey: "hermi.preview.invites.\(place.id)") ?? []) }
  }
}
