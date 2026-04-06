import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { API } from '../utils/api';

function groupByCategory(questions) {
    return questions.reduce((acc, q) => {
        const key = q.categoryName || 'Uncategorized';
        if (!acc[key]) acc[key] = [];
        acc[key].push(q);
        return acc;
    }, {});
}

export default function QuestionBankView() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const gameId = searchParams.get('gameId') || '';

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [backfilling, setBackfilling] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState('');

    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');

    const [questions, setQuestions] = useState([]);
    const [categories, setCategories] = useState([]);
    const [total, setTotal] = useState(0);

    const [selectedIds, setSelectedIds] = useState([]);
    const [game, setGame] = useState(null);
    const [targetCategoryId, setTargetCategoryId] = useState('');

    const groupedQuestions = useMemo(() => groupByCategory(questions), [questions]);

    const loadGameContext = async () => {
        if (!gameId) {
            setGame(null);
            setTargetCategoryId('');
            return;
        }

        const gameData = await API.getGame(gameId);
        setGame(gameData);
        const firstCategoryId = gameData.categories?.[0]?.id || '';
        setTargetCategoryId(prev => prev || firstCategoryId);
    };

    const loadBank = async () => {
        setLoading(true);
        setError('');
        try {
            const data = await API.listQuestionBank({ category: categoryFilter, search, limit: 250, skip: 0 });
            setQuestions(data.questions || []);
            setCategories(data.categories || []);
            setTotal(data.total || 0);
        } catch (e) {
            setError(e.message || 'Failed to load question bank');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadGameContext().catch((e) => setError(e.message || 'Failed to load game context'));
    }, [gameId]);

    useEffect(() => {
        loadBank();
    }, [categoryFilter]);

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        loadBank();
    };

    const toggleSelected = (id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const selectedCount = selectedIds.length;
    const targetCategory = game?.categories?.find(c => c.id === targetCategoryId);
    const remainingSlots = Math.max(0, 5 - (targetCategory?.questions?.length || 0));

    const handleImport = async () => {
        if (!gameId || !targetCategoryId) return;
        if (selectedCount === 0) return;

        setSaving(true);
        setError('');
        try {
            const payload = await API.importQuestionsToCategory(gameId, targetCategoryId, selectedIds);
            setSelectedIds([]);
            await loadGameContext();
            alert(`Imported ${payload.importedCount} question(s) into ${targetCategory?.name || 'category'}.`);
        } catch (e) {
            setError(e.message || 'Import failed');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this question from the bank?')) return;
        try {
            await API.deleteQuestionBankQuestion(id);
            setSelectedIds(prev => prev.filter(x => x !== id));
            await loadBank();
        } catch (e) {
            setError(e.message || 'Delete failed');
        }
    };

    const runBackfill = async () => {
        if (!window.confirm('Backfill all historical game questions into the bank now?')) return;
        setBackfilling(true);
        setError('');
        try {
            const result = await API.backfillQuestionBank();
            await loadBank();
            alert(`Backfill complete. Inserted: ${result.inserted}, Updated: ${result.updated}`);
        } catch (e) {
            setError(e.message || 'Backfill failed');
        } finally {
            setBackfilling(false);
        }
    };

    const handleExportExcel = async () => {
        setExporting(true);
        setError('');
        try {
            await API.downloadQuestionBankExcel();
        } catch (e) {
            setError(e.message || 'Export failed');
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="app-wrapper" style={{ padding: '2rem' }}>
            <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
                <div className="qb-header-row">
                    <div>
                        <h2 style={{ color: 'var(--text-secondary)' }}>QUESTION BANK</h2>
                        <p className="text-muted" style={{ marginTop: '.3rem' }}>{total} saved questions across games</p>
                    </div>
                    <div className="qb-header-actions">
                        {gameId && <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/host/${gameId}`)}>← Back to Host Setup</button>}
                        <button className="btn btn-primary btn-sm" onClick={handleExportExcel} disabled={exporting}>
                            {exporting ? 'Exporting...' : '⬇ Download Excel'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={runBackfill} disabled={backfilling}>{backfilling ? 'Backfilling...' : '↻ Backfill Existing Games'}</button>
                    </div>
                </div>

                <div className="card" style={{ marginTop: '1rem' }}>
                    <form className="qb-filter-row" onSubmit={handleSearchSubmit}>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="Search clue, answer, or category"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <select className="difficulty-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                            <option value="">All categories</option>
                            {categories.map(c => (
                                <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
                            ))}
                        </select>
                        <button className="btn btn-primary" type="submit">Search</button>
                    </form>
                </div>

                {game && (
                    <div className="card" style={{ marginTop: '1rem' }}>
                        <div className="qb-import-row">
                            <div>
                                <div style={{ fontWeight: 700, marginBottom: '.4rem' }}>Import into current game: {game.name}</div>
                                <div className="text-muted" style={{ fontSize: '.85rem' }}>Rule: import appends until category reaches 5 questions.</div>
                            </div>
                            <div className="qb-import-controls">
                                <select className="difficulty-select" value={targetCategoryId} onChange={(e) => setTargetCategoryId(e.target.value)}>
                                    {game.categories?.map(c => (
                                        <option key={c.id} value={c.id}>{c.name} ({c.questions?.length || 0}/5)</option>
                                    ))}
                                </select>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleImport}
                                    disabled={saving || !targetCategoryId || selectedCount === 0 || remainingSlots <= 0}
                                >
                                    {saving ? 'Importing...' : `Import Selected (${selectedCount})`}
                                </button>
                            </div>
                        </div>
                        <div className="text-muted" style={{ marginTop: '.75rem', fontSize: '.85rem' }}>
                            Remaining slots in selected category: {remainingSlots}
                        </div>
                    </div>
                )}

                {error && <div className="manual-error" style={{ marginTop: '1rem' }}>{error}</div>}

                {loading ? (
                    <div className="card" style={{ marginTop: '1rem' }}>Loading question bank...</div>
                ) : questions.length === 0 ? (
                    <div className="card" style={{ marginTop: '1rem' }}>No saved questions found for the current filter.</div>
                ) : (
                    <div style={{ marginTop: '1rem' }}>
                        {Object.entries(groupedQuestions).map(([categoryName, items]) => (
                            <div className="card qb-category-card" key={categoryName}>
                                <div className="qb-category-head">
                                    <h3>{categoryName}</h3>
                                    <span className="text-muted">{items.length} question(s)</span>
                                </div>
                                <div className="qb-question-grid">
                                    {items.map(item => {
                                        const isSelected = selectedIds.includes(item.id);
                                        return (
                                            <div className={`qb-question-card ${isSelected ? 'selected' : ''}`} key={item.id}>
                                                <label className="qb-check-row">
                                                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(item.id)} />
                                                    <span className="question-value">${item.value}</span>
                                                </label>
                                                <div className="question-text">{item.question}</div>
                                                <div className="answer-text"><span className="answer-label">A: </span>{item.answer}</div>
                                                <div className="qb-card-footer">
                                                    <span className="text-muted">Used {item.usageCount || 0} time(s)</span>
                                                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => handleDelete(item.id)}>Delete</button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
