import React from 'react';

export default function JeopardyBoard({ game, onTileClick }) {
    if (!game || !game.categories) return null;

    const categories = game.categories;
    const numCols = categories.length;

    // Get all unique point values sorted
    const allValues = [...new Set(
        categories.flatMap(c => c.questions?.map(q => q.value) || [])
    )].sort((a, b) => a - b);

    return (
        <div className="board-grid" style={{ gridTemplateColumns: `repeat(${numCols}, 1fr)` }}>
            {/* Headers */}
            {categories.map((cat, i) => (
                <div key={i} className="board-category-header">{cat.name}</div>
            ))}

            {/* Tiles grouped by point value */}
            {allValues.map((val) => (
                categories.map((cat, j) => {
                    const q = cat.questions?.find(q => q.value === val);
                    if (q) {
                        return (
                            <div 
                                key={`${cat.id}-${q.id}`} 
                                className={`board-tile ${q.answered ? 'answered' : ''}`}
                                onClick={() => !q.answered && onTileClick(cat.id, q.id)}
                            >
                                <span className="tile-value">{q.answered ? '' : `$${val}`}</span>
                            </div>
                        );
                    } else {
                        return (
                            <div key={`empty-${j}-${val}`} className="board-tile answered">
                                <span className="tile-value"></span>
                            </div>
                        );
                    }
                })
            ))}
        </div>
    );
}
