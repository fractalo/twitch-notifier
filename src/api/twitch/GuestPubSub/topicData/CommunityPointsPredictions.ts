interface PredictionsManager {
    type: string | null;
    user_id: string | null;
    user_display_name: string | null;
    extension_client_id: string | null;
}

interface PredictionsResult {
    type: string | null;
    points_won: number | null;
    is_acknowledged: boolean | null;
}

interface PredictionsBadge {
    version: string | null;
    set_id: string | null;
}

interface Predictor {
    id: string | null;
    event_id: string | null;
    outcome_id: string | null;
    channel_id: string | null;
    points: number | null;
    predicted_at: string | null;
    updated_at: string | null;
    user_id: string | null;
    result: PredictionsResult | null;
    user_display_name: string | null;
}

interface PredictionsOutcome {
    id: string | null;
    color: string | null;
    title: string | null;
    total_points: number | null;
    total_users: number | null;
    top_predictors: Predictor[] | null;
    badge: PredictionsBadge | null;
}

type PredictionsStatus = "ACTIVE" | "LOCKED" | "RESOLVE_PENDING" | "RESOLVED" | "CANCEL_PENDING" | "CANCELED";

export interface CommunityPointsPredictions {
    type: string | null;
    data: {
        timestamp: string | null;
        event: {
            id: string | null;
            channel_id: string | null;
            created_at: string | null;
            created_by: PredictionsManager | null;
            ended_at: string | null;
            ended_by: PredictionsManager | null;
            locked_at: string | null;
            locked_by: string | null;
            outcomes: PredictionsOutcome[] | null;
            prediction_window_seconds: number | null;
            status: PredictionsStatus | null;
            title: string | null;
            winning_outcome_id: string | null;
        }
    }
}